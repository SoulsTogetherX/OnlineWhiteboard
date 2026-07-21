//#region Imports
import { useCallback, useRef, useState, type RefObject } from "react"

import useSessionID from "./useSessionID"
import { holdLocalPixels } from "@/utils/localHold"
import { reanchorEntries } from "@/utils/reanchor"

import { applyDrawInstructionToCanvas } from "@shared/utils/handleCanvasProtocol"
import {
  canvasDimsOf,
  getCanvasState,
  updateCanvas,
} from "@shared/utils/helperProtocolMethods"

import type { CanvasDims } from "@shared/constants/canvas"
import type {
  DrawInstruction,
  PatchEntry,
  PatchInstruction,
} from "@shared/types/drawProtocol"
//#endregion

//#region Constants
// Cap by whichever limit is hit first — a long, thin scribble is cheap
// (few entries, many actions), a single big bucket fill is expensive (few
// actions, many entries). Neither cap alone protects against both shapes.
const MAX_ACTIONS = 50
// The byte cap only ever bites on big fills — a typical stroke is a few thousand
// entries — so it is really "how many whole-canvas gestures stay undoable".
//
// It was 64 KB, which at the estimate below is ~550 entries: less than ONE
// large-brush stroke. Every big gesture evicted the one before it, so filling the
// canvas and pressing undo twice did nothing the second time. 48 MB holds several
// full 256-canvas repaints (or one of the largest 512 canvas), which is a
// rounding error against what a canvas app already keeps in the page.
const MAX_BYTES = 48 * 1024 * 1024
// An entry is {idx, from:{r,g,b,a}, to:{r,g,b,a}} — three JS objects, not 16
// packed bytes. The old figure was the WIRE size (patchCodec packs 12 bytes an
// entry); in the heap, per-object headers and boxed numbers dominate. Estimating
// low here is what made the cap ~30x tighter than it read.
const BYTES_PER_ENTRY = 120
const NOTICE_DURATION_MS = 3_000
//#endregion

//#region Type Defs
type Action = {
  instructionId: number
  entries: PatchEntry[]
}

export type UseUndoRedoResult = {
  pushAction: (instructionId: number, entries: PatchEntry[]) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  notice: string | null
  reanchorHistory: (from: CanvasDims, to: CanvasDims) => void
}
//#endregion

//#region Helper Methods
function estimateBytes(entries: PatchEntry[]): number {
  return entries.length * BYTES_PER_ENTRY
}

// Reverses a patch's direction: {idx, from, to} -> {idx, from: to, to: from}.
// Undoing an action replays it backwards; redoing plays it forwards again.
function reversed(entries: PatchEntry[]): PatchEntry[] {
  return entries.map((e) => ({ idx: e.idx, from: e.to, to: e.from }))
}

function enforceCap(stack: Action[]): void {
  let totalBytes = stack.reduce((sum, a) => sum + estimateBytes(a.entries), 0)
  // Keep at least the MOST RECENT action (`stack.length > 1`): you must always be
  // able to undo your last gesture, even a big-brush stroke that alone exceeds
  // MAX_BYTES. Without this, a single large stroke was evicted the instant it was
  // pushed — while pushAction still lit `canUndo` — so undo looked available but
  // did nothing (a ~19px brush stroke is enough to blow past 64 KB / 4096 entries).
  while (
    stack.length > 1 &&
    (stack.length > MAX_ACTIONS || totalBytes > MAX_BYTES)
  ) {
    const removed = stack.shift()
    if (removed) {
      totalBytes -= estimateBytes(removed.entries)
    }
  }
}
//#endregion

//#region Hook Def
export default function useUndoRedo(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  sendDrawInstruction: (instruction: DrawInstruction) => void,
): UseUndoRedoResult {
  const sessionId = useSessionID()
  const nextInstructionId = useRef<number>(0)

  const undoStack = useRef<Action[]>([])
  const redoStack = useRef<Action[]>([])

  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showNotice = useCallback((message: string) => {
    if (noticeTimer.current) {
      clearTimeout(noticeTimer.current)
    }
    setNotice(message)
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_DURATION_MS)
  }, [])

  // Called by the drawing hook once a whole gesture (stroke or fill)
  // finishes — never sent over the network itself, purely local bookkeeping.
  const pushAction = useCallback(
    (instructionId: number, entries: PatchEntry[]) => {
      if (entries.length === 0) {
        return
      }
      undoStack.current.push({ instructionId, entries: [...entries] })
      redoStack.current = [] // a new action invalidates the redo branch
      enforceCap(undoStack.current)
      setCanUndo(undoStack.current.length > 0)
      setCanRedo(false)
    },
    [],
  )

  // Shared by undo() and redo(): builds a patch instruction from `entries`,
  // applies it locally through the same CAS-guarded path the server uses,
  // repaints, and sends the (possibly filtered) result to the server. Never
  // touches the network if nothing was actually applied.
  const applyLocally = useCallback(
    (entries: PatchEntry[]): PatchInstruction | null => {
      const canvas = canvasRef.current
      if (!canvas) {
        return null
      }
      const dims = canvasDimsOf(canvas)
      const canvasState = getCanvasState(canvas, dims)
      if (!canvasState) {
        return null
      }

      const instruction: PatchInstruction = {
        type: "patch",
        entries,
        instructionId: nextInstructionId.current++,
        sessionId,
      }

      const applied = applyDrawInstructionToCanvas(
        canvasState.imageData,
        instruction,
        dims,
      )
      if (!applied) {
        return null
      }
      updateCanvas(canvas, dims)

      const appliedPatch = applied as PatchInstruction
      // An undo/redo is a local action too — hold the pixels it just changed so a
      // colliding remote instruction cannot visibly undo the undo for 100 ms.
      holdLocalPixels(appliedPatch.entries, Date.now())
      sendDrawInstruction(appliedPatch)
      return appliedPatch
    },
    [canvasRef, sendDrawInstruction, sessionId],
  )

  const undo = useCallback(() => {
    const action = undoStack.current.pop()
    if (!action) {
      return
    }

    const applied = applyLocally(reversed(action.entries))
    if (!applied) {
      showNotice("Nothing to undo — that area was already changed")
      setCanUndo(undoStack.current.length > 0)
      return
    }

    redoStack.current.push({
      instructionId: action.instructionId,
      entries: reversed(applied.entries),
    })
    enforceCap(redoStack.current)

    if (applied.entries.length < action.entries.length) {
      showNotice("Undo only partially applied — someone else drew over part of it")
    }

    setCanUndo(undoStack.current.length > 0)
    setCanRedo(true)
  }, [applyLocally, showNotice])

  const redo = useCallback(() => {
    const action = redoStack.current.pop()
    if (!action) {
      return
    }

    const applied = applyLocally(action.entries)
    if (!applied) {
      showNotice("Nothing to redo — that area was already changed")
      setCanRedo(redoStack.current.length > 0)
      return
    }

    undoStack.current.push({
      instructionId: action.instructionId,
      entries: applied.entries,
    })
    enforceCap(undoStack.current)

    if (applied.entries.length < action.entries.length) {
      showNotice("Redo only partially applied — someone else drew over part of it")
    }

    setCanRedo(redoStack.current.length > 0)
    setCanUndo(true)
  }, [applyLocally, showNotice])

  // Re-anchors both stacks to a resized canvas rather than discarding them. Each
  // stored entry's byte index encodes the OLD stride, so after a width change it
  // would point at the wrong pixel (in-range) or out of range — neither of which
  // is safe: an in-range wrong index corrupts, and an out-of-range one fails the
  // WHOLE undo action, because a patch is validated all-or-nothing. Re-indexing
  // top-left (matching how the pixels themselves are cropped/padded) keeps every
  // entry whose pixel still exists and drops only those a shrink cut away, so a
  // partly-cropped stroke still undoes its surviving part. See @/utils/reanchor.
  const reanchorHistory = useCallback((from: CanvasDims, to: CanvasDims) => {
    const remap = (action: Action): Action | null => {
      const entries = reanchorEntries(action.entries, from, to)
      return entries.length > 0 ? { ...action, entries } : null
    }
    undoStack.current = undoStack.current
      .map(remap)
      .filter((action): action is Action => action !== null)
    redoStack.current = redoStack.current
      .map(remap)
      .filter((action): action is Action => action !== null)
    setCanUndo(undoStack.current.length > 0)
    setCanRedo(redoStack.current.length > 0)
  }, [])

  return { pushAction, undo, redo, canUndo, canRedo, notice, reanchorHistory }
}
//#endregion
