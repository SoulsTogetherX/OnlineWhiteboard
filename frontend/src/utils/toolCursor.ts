//#region Imports
import { toolById } from "@/components/SideBar/DrawingTab/tools"

import type { AppTool } from "@/components/SideBar/DrawingTab/tools"
//#endregion

//#region Constants
// Drawn at 20px so the glyph is legible without covering the pixel being aimed
// at. The hotspot is expressed in the icon's own coordinate box (iconBox) and
// scaled to this, so a glyph authored at any size lands its hotspot correctly.
const CURSOR_SIZE = 20
//#endregion

//#region Builder
// The CSS `cursor` value that draws a tool's own glyph as the pointer.
//
// Built from the same path data the picker and the remote cursors use
// (tools.tsx), so the tool you hold, the tool in the sidebar and the tool
// everyone else sees over your shoulder cannot drift apart.
//
// The glyph is stroked white underneath its fill (paint-order: stroke) for the
// same reason the remote cursors are: the canvas can be any colour, including
// exactly the cursor's, and a shape with no outline vanishes against itself.
export function toolCursorCss(tool: AppTool): string {
  const { iconPath, hotspot, iconBox } = toolById(tool)

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CURSOR_SIZE}" height="${CURSOR_SIZE}" viewBox="0 0 ${iconBox} ${iconBox}">` +
    `<path d="${iconPath}" fill="black" stroke="white" stroke-width="1.1" paint-order="stroke"/>` +
    `</svg>`

  // encodeURIComponent, not base64: it keeps the URI readable in devtools and
  // avoids pulling in a base64 helper for what is already a valid data URI.
  const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`
  const x = Math.round((hotspot[0] / iconBox) * CURSOR_SIZE)
  const y = Math.round((hotspot[1] / iconBox) * CURSOR_SIZE)

  // The trailing keyword is the fallback for anything that refuses the image —
  // never `auto`, because an arrow over a drawing surface is the wrong default.
  return `url("${uri}") ${x} ${y}, crosshair`
}
//#endregion
