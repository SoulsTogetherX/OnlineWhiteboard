//#region Type Def
export type ColorType = {
  r: number
  g: number
  b: number
  a: number
}

export type ColorPalette = {
  primary: ColorType
  secondary: ColorType
}
export type ColorPaletteKeys = keyof ColorPalette

export type Vec = [number, number]
//#endregion

//#region Helper Methods
export function colorTypeToString(ct: ColorType): string {
  return `rgba(${ct.r}, ${ct.g}, ${ct.b}, ${ct.a / 255})`
}

// Four-channel colour equality, alpha included.
//
// Lives here, beside ColorType, because three separate call sites need exactly
// this comparison and each had grown its own copy: the flood fill ("is this
// pixel still the colour we're replacing?"), the compare-and-swap undo patch
// ("does this pixel still hold `from`?"), and the client's colour utilities.
//
// One implementation is not just tidiness here. The fill and the undo CAS must
// agree on what "the same colour" means — if they ever diverged, an undo would
// apply where a fill thought it hadn't (or vice versa) and that client's canvas
// would silently drift from the server's authoritative buffer.
export function colorsEqual(a: ColorType, b: ColorType): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a
}
//#endregion
