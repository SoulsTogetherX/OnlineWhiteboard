//#region Type Def
type ColorType = {
  r: number
  g: number
  b: number
  a: number
}
//#endregion

//#region Helper Methods
function colorTypeToString(ct: ColorType): string {
  return `rgba(${ct.r}, ${ct.g}, ${ct.b}, ${ct.a})`
}
//#endregion

//#region Exports
export { colorTypeToString }
export type { ColorType }
//#endregion
