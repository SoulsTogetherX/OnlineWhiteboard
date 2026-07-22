//#region Imports
import { useEffect } from "react"

import {
  canvasDimsOf,
  forEachDiscPixel,
  getPosCorrected,
} from "@shared/utils/helperProtocolMethods"
import { blurRadiusFor } from "@shared/utils/handleBlurProtocol"

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
  // While this reads true the preview stays hidden: a viewer cannot draw, so
  // promising them a brush footprint would be a lie.
  disabledRef?: React.RefObject<boolean>,
): void {
  useEffect(() => {
    const canvas = canvasRef.current
    const preview = previewRef.current
    if (!canvas || !preview) {
      return
    }

    const clear = () => {
      const ctx = preview.getContext("2d")
      ctx?.clearRect(0, 0, preview.width, preview.height)
    }

    const render = (ev: PointerEvent) => {
      const ctx = preview.getContext("2d")
      if (!ctx) {
        return
      }
      ctx.clearRect(0, 0, preview.width, preview.height)

      const tool = toolRef.current

      // Nothing to preview when the pointer is not going to paint: shift is the
      // navigate modifier, and the grabber is that modifier latched on. Showing
      // a footprint then promises a mark that dragging will not make.
      if (ev.shiftKey || tool === "grabber" || disabledRef?.current === true) {
        return
      }

      const dims = canvasDimsOf(canvas)
      const [pos] = getPosCorrected(ev, canvas)

      // Which pixels this tool would touch at this position. Bucket and
      // eyedropper both act on a single pixel from the pointer's point of view
      // (the fill's SPREAD depends on canvas contents, which is not something to
      // recompute on every pointer move), so they preview as one pixel.
      //
      // The blur was missing here and previewed as that single pixel, which was
      // wrong rather than absent — it covers a disc like the brushes do. Its
      // footprint is a RADIUS of `size` (see blurRadiusFor), and forEachDiscPixel
      // takes a diameter, so it is twice what the stroke tools pass. Getting that
      // factor wrong would draw an outline that does not match what the tool
      // actually changes, which is worse than showing nothing.
      const usesBrush = tool === "pencil" || tool === "eraser" || tool === "spray"
      const size = usesBrush
        ? strokeSizeRef.current
        : tool === "blur"
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
    }

    canvas.addEventListener("pointermove", render)
    canvas.addEventListener("pointerdown", render)
    canvas.addEventListener("pointerleave", clear)
    // A tool or size change while the pointer sits still would otherwise leave
    // the old footprint on screen until the next move.
    window.addEventListener("keyup", clear)

    return () => {
      canvas.removeEventListener("pointermove", render)
      canvas.removeEventListener("pointerdown", render)
      canvas.removeEventListener("pointerleave", clear)
      window.removeEventListener("keyup", clear)
      clear()
    }
  }, [canvasRef, previewRef, toolRef, strokeSizeRef, disabledRef])
}
//#endregion
