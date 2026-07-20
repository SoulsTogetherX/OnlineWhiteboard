//#region Imports
import { useCallback, useRef, useState, type RefObject } from "react"

import useSessionID from "./useSessionID"
import { holdLocalPixels } from "@/utils/localHold"

import { applyDrawInstructionToCanvas } from "@shared/utils/handleCanvasProtocol"
import {
  canvasDimsOf,
  getCanvasState,
  updateCanvas,
} from "@shared/utils/helperProtocolMethods"

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
const MAX_BYTES = 64 * 1024
const BYTES_PER_ENTRY = 16 // idx + two RGBA colors, rounded up for overhead
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
  resetHistory: () => void
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
  while (
    stack.length > 0 &&
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
      setCanUndo(true)
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

  // Drops both stacks. Called when the canvas is REPLACED under the history —
  // most importantly a resize, after which every stored entry's byte index
  // refers to a pixel at the OLD stride and would undo onto the wrong place (or,
  // on a shrink, be rejected). The recorded pixels no longer describe this
  // canvas, so the honest thing is to forget them.
  const resetHistory = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    setCanUndo(false)
    setCanRedo(false)
  }, [])

  return { pushAction, undo, redo, canUndo, canRedo, notice, resetHistory }
}
//#endregion
