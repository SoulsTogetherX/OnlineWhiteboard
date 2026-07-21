//#region Why HSV
// A visual colour picker is built around HSV (hue / saturation / value), not
// RGB: hue is the rainbow strip, and the 2D square is saturation × value. RGB
// is what the canvas stores, so we convert at the edges. These are the standard
// conversions; kept here (not in shared/) because colour-space maths is purely a
// frontend concern.
//#endregion

//#region Types
// Not exported: only rgbToHsv's return annotation uses it. Callers destructure
// the result rather than naming the type.
type Hsv = { h: number; s: number; v: number } // h 0–360, s/v 0–1
//#endregion

//#region Imports
import type { ColorType } from "@shared/types/primitive"
//#endregion

//#region RGB <-> HSV
export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === rn) {
      h = ((gn - bn) / delta) % 6
    } else if (max === gn) {
      h = (bn - rn) / delta + 2
    } else {
      h = (rn - gn) / delta + 4
    }
    h *= 60
    if (h < 0) {
      h += 360
    }
  }

  const s = max === 0 ? 0 : delta / max
  return { h, s, v: max }
}

export function hsvToRgb(
  h: number,
  s: number,
  v: number,
): { r: number; g: number; b: number } {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c

  let r: number
  let g: number
  let b: number
  if (h < 60) {
    ;[r, g, b] = [c, x, 0]
  } else if (h < 120) {
    ;[r, g, b] = [x, c, 0]
  } else if (h < 180) {
    ;[r, g, b] = [0, c, x]
  } else if (h < 240) {
    ;[r, g, b] = [0, x, c]
  } else if (h < 300) {
    ;[r, g, b] = [x, 0, c]
  } else {
    ;[r, g, b] = [c, 0, x]
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}
//#endregion

//#region Hex <-> ColorType
// Exported because the RGBA number inputs in ColorPopup need exactly this
// coercion for user-typed values, and had reimplemented it byte-for-byte.
// Non-finite input (a cleared or malformed field) collapses to 0 rather than
// NaN, which would otherwise propagate into the canvas as a corrupt channel.
export function clampByte(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(255, Math.round(value)))
}

function toHex2(value: number): string {
  return clampByte(value).toString(16).padStart(2, "0")
}

// "#rrggbb" (alpha dropped — the swatch chips and native input are opaque).
export function colorToHex(color: ColorType): string {
  return `#${toHex2(color.r)}${toHex2(color.g)}${toHex2(color.b)}`
}

// "#rrggbbaa" — the canonical string a saved/recent colour is stored as, so the
// alpha survives a round-trip through storage or the API.
export function colorToHex8(color: ColorType): string {
  return `${colorToHex(color)}${toHex2(color.a)}`
}

// Parses "#rgb", "#rrggbb" or "#rrggbbaa" (with or without the leading #).
// Returns null for anything malformed so callers can reject bad stored data.
export function hexToColor(hex: string): ColorType | null {
  let clean = hex.trim().replace(/^#/, "")
  if (clean.length === 3) {
    clean = clean
      .split("")
      .map((ch) => ch + ch)
      .join("")
  }
  if (clean.length !== 6 && clean.length !== 8) {
    return null
  }
  if (!/^[0-9a-fA-F]+$/.test(clean)) {
    return null
  }
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
    a: clean.length === 8 ? parseInt(clean.slice(6, 8), 16) : 255,
  }
}
//#endregion

//#region Readable text on a coloured background
// Relative luminance per WCAG 2.x: linearise each sRGB channel, then weight by
// how bright the eye perceives it (green dominates, blue barely registers).
function relativeLuminance(r: number, g: number, b: number): number {
  const linear = (channel: number) => {
    const s = channel / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

// Picks black or white text for a given background so the label stays legible —
// the whole point of this file's presence in the cursor overlay, where a light
// identity colour (pale green, pink, lavender) with hardcoded white text was
// unreadable. Returns whichever of black/white has the higher WCAG contrast
// ratio against the background; the crossover sits at luminance ≈ 0.179.
// Malformed input falls back to black (the safer default on the light UI).
export function readableTextColor(background: string): "#000000" | "#ffffff" {
  const color = hexToColor(background)
  if (color === null) {
    return "#000000"
  }
  const luminance = relativeLuminance(color.r, color.g, color.b)
  const contrastWithBlack = (luminance + 0.05) / 0.05
  const contrastWithWhite = 1.05 / (luminance + 0.05)
  return contrastWithBlack >= contrastWithWhite ? "#000000" : "#ffffff"
}
//#endregion

// NOTE: colorsEqual used to live here too. It now lives in
// shared/types/primitive.ts, because the flood fill and the compare-and-swap
// undo patch need the same comparison and all three had drifted into separate
// copies. Import it from @shared/types/primitive.
