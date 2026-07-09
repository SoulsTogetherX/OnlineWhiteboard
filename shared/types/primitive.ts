//#region Type Def
export type ColorType = {
  r: number
  g: number
  b: number
  a: number
}

export type ColorPallet = {
  primary: ColorType
  secondary: ColorType
}
export type ColorPalletKeys = keyof ColorPallet

export type Vec = [number, number]
//#endregion

//#region Helper Methods
export function colorTypeToString(ct: ColorType): string {
  return `rgba(${ct.r}, ${ct.g}, ${ct.b}, ${ct.a / 255})`
}
//#endregion
