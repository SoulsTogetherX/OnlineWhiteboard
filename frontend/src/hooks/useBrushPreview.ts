//#region Imports
import { useCallback, useEffect, useLayoutEffect, useRef } from "react"

import {
  canvasDimsOf,
  forEachDiscPixel,
  getPosCorrected,
} from "@shared/utils/helperProtocolMethods"
import { blurRadiusFor } from "@shared/utils/handleBlurProtocol"

import type { Vec } from "@shared/types/primitive"
import type { AppTool } from "@/components/SideBar/DrawingTab/tools"
//#endregion

//#region Constants
// The two colours the outline alternates between. Alternating rather than
// picking one means the outline is visible against ANY canvas content: a black
// board keeps the white dots, a white board keeps the black ones.
const DOT_LIGHT = "rgba(255, 255, 255, 0.95)"
const DOT_DARK = "rgba(0, 0, 0, 0.85)"
//#endregion

//#region Hook Def
// Draws a dotted outline of exactly the pixels the current tool would change,
// following the pointer.
//
// It runs the SAME `forEachDiscPixel` the brush itself paints with, so the
// preview cannot promise a shape the stroke does not deliver — the alternative,
// approximating the brush with a circle, drifts from reality at small sizes
// where the disc is a handful of pixels and its exact shape matters most.
//
// The outline is drawn as alternating boundary PIXELS rather than a stroked
// path. On a canvas magnified with `image-rendering: pixelated`, a stroke would
// be resampled into blurry or uneven edges; filling pixels keeps the preview in
// the same units as the thing it describes and stays crisp at any zoom.
export default function useBrushPreview(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  previewRef: React.RefObject<HTMLCanvasElement | null>,
  toolRef: React.RefObject<AppTool>,
  strokeSizeRef: React.RefObject<number>,
  // The size and tool are ALSO passed as plain values, not only through the refs
  // above. The refs are what the pointer handlers read on every move (a ref so
  // moving the pointer never re-subscribes them); the values are what tell the
  // redraw effect below that the footprint changed while the pointer was NOT
  // moving — dragging the size slider, or scrolling it with the wheel. Without
  // them the outline only updated on the next pointer event, so it lagged the
  // slider until you nudged the mouse.
  strokeSize: number,
  tool: AppTool,
  // While this reads true the preview stays hidden: a viewer cannot draw, so
  // promising them a brush footprint would be a lie.
  disabledRef?: React.RefObject<boolean>,
): void {
  // The last position the pointer was seen at, in canvas pixel coordinates, kept
  // across renders so a size or tool change can redraw the footprint exactly
  // where the pointer already is. Null while the pointer is off the canvas, so
  // an off-canvas size change draws nothing rather than a stray outline.
  const lastPosRef = useRef<Vec | null>(null)

  // Draws the footprint at a KNOWN canvas position, independent of any pointer
  // event, so both the pointer handlers and the size/tool redraw effect can call
  // it. Everything it reads comes from stable refs, so the callback identity is
  // stable — which is what lets the listener effect subscribe exactly once.
  //
  // `navigating` is passed in because only a real pointer event carries the
  // shift state; the value-change redraw is never a navigate gesture.
  const draw = useCallback(
    (pos: Vec, navigating: boolean) => {
      const canvas = canvasRef.current
      const preview = previewRef.current
      if (!canvas || !preview) {
        return
      }
      const ctx = preview.getContext("2d")
      if (!ctx) {
        return
      }
      ctx.clearRect(0, 0, preview.width, preview.height)

      const activeTool = toolRef.current

      // Nothing to preview when the pointer is not going to paint: shift is the
      // navigate modifier, and the grabber is that modifier latched on. Showing a
      // footprint then promises a mark that dragging will not make.
      if (
        navigating ||
        activeTool === "grabber" ||
        disabledRef?.current === true
      ) {
        return
      }

      const dims = canvasDimsOf(canvas)

      // Which pixels this tool would touch at this position. Bucket and
      // eyedropper both act on a single pixel from the pointer's point of view
      // (the fill's SPREAD depends on canvas contents, which is not something to
      // recompute on every pointer move), so they preview as one pixel.
      //
      // The blur covers a disc like the brushes do. Its footprint is a RADIUS of
      // `size` (see blurRadiusFor), and forEachDiscPixel takes a diameter, so it
      // is twice what the stroke tools pass. Getting that factor wrong would draw
      // an outline that does not match what the tool actually changes.
      const usesBrush =
        activeTool === "pencil" ||
        activeTool === "eraser" ||
        activeTool === "spray"
      const size = usesBrush
        ? strokeSizeRef.current
        : activeTool === "blur"
          ? blurRadiusFor(strokeSizeRef.current) * 2
          : 1

      const covered = new Set<number>()
      forEachDiscPixel(pos[0], pos[1], size, dims, ([x, y]) => {
        covered.add(y * dims.width + x)
      })

      // A pixel is on the boundary when any 4-neighbour is outside the shape —
      // including off-canvas, so a brush clipped by the edge still outlines.
      const isCovered = (x: number, y: number) =>
        x >= 0 &&
        y >= 0 &&
        x < dims.width &&
        y < dims.height &&
        covered.has(y * dims.width + x)

      for (const index of covered) {
        const x = index % dims.width
        const y = Math.floor(index / dims.width)
        const onEdge =
          !isCovered(x - 1, y) ||
          !isCovered(x + 1, y) ||
          !isCovered(x, y - 1) ||
          !isCovered(x, y + 1)
        if (!onEdge) {
          continue
        }
        // The checkerboard is what makes it read as dotted, and it is keyed to
        // absolute position so the dots stay put as the brush moves instead of
        // crawling.
        ctx.fillStyle = (x + y) % 2 === 0 ? DOT_DARK : DOT_LIGHT
        ctx.fillRect(x, y, 1, 1)
      }
    },
    [canvasRef, previewRef, toolRef, strokeSizeRef, disabledRef],
  )

  // Pointer wiring. Subscribes once — `draw` is stable, so nothing here re-runs
  // when the size changes.
  useEffect(() => {
    const canvas = canvasRef.current
    const preview = previewRef.current
    if (!canvas || !preview) {
      return
    }

    const clear = () => {
      preview.getContext("2d")?.clearRect(0, 0, preview.width, preview.height)
    }

    const render = (ev: PointerEvent) => {
      const [pos] = getPosCorrected(ev, canvas)
      lastPosRef.current = pos
      draw(pos, ev.shiftKey)
    }

    const onLeave = () => {
      // Forget the position too, so a size change with the pointer off the canvas
      // does not paint a footprint into empty space.
      lastPosRef.current = null
      clear()
    }

    // Releasing a key ends a possible navigate gesture (shift), so bring the
    // footprint back at the last position rather than waiting for a move.
    const onKeyUp = () => {
      if (lastPosRef.current) {
        draw(lastPosRef.current, false)
      }
    }

    canvas.addEventListener("pointermove", render)
    canvas.addEventListener("pointerdown", render)
    canvas.addEventListener("pointerleave", onLeave)
    window.addEventListener("keyup", onKeyUp)

    return () => {
      canvas.removeEventListener("pointermove", render)
      canvas.removeEventListener("pointerdown", render)
      canvas.removeEventListener("pointerleave", onLeave)
      window.removeEventListener("keyup", onKeyUp)
      clear()
    }
  }, [canvasRef, previewRef, draw])

  // The live redraw. Repaints the footprint at the last-known pointer position
  // whenever the size or tool VALUE changes, which is what makes the outline
  // track the slider (and the wheel over it) without waiting for a pointer move.
  //
  // useLayoutEffect, not useEffect: it fires synchronously at commit, before the
  // browser paints, so the resized outline lands in the same frame as the number
  // it reflects instead of trailing it. strokeSizeRef is already current here —
  // setStrokeSize writes the ref synchronously before the state update that runs
  // this — so `draw` reads the new size.
  useLayoutEffect(() => {
    if (lastPosRef.current) {
      draw(lastPosRef.current, false)
    }
  }, [strokeSize, tool, draw])
}
//#endregion
