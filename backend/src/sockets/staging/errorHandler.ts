//#region Error Methods
export function onSocketPreError(err: Error) {
  throw new Error("Pre: ${err}")
}
export function onSocketPostError(err: Error) {
  throw new Error("Post: ${err}")
}
//#endregion
