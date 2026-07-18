//#region Download the canvas as a PNG
// The drawing canvas is only 120x120 internally, so exporting it directly gives
// a postage-stamp image. We scale it up onto an offscreen canvas with image
// smoothing OFF, so the pixel art stays crisp (nearest-neighbour) instead of
// turning into a blurry mess — the right choice for pixel art specifically.
//
// Transparency is preserved: erased/unpainted pixels have alpha 0 and stay
// transparent in the PNG, matching what the canvas actually holds.
const EXPORT_SCALE = 8

export function downloadCanvasImage(
  source: HTMLCanvasElement,
  roomId: string,
): void {
  const scaled = document.createElement("canvas")
  scaled.width = source.width * EXPORT_SCALE
  scaled.height = source.height * EXPORT_SCALE

  const ctx = scaled.getContext("2d")
  if (!ctx) {
    return
  }
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, 0, 0, scaled.width, scaled.height)

  scaled.toBlob((blob) => {
    if (!blob) {
      return
    }
    // A blob: URL + <a download> triggers a save without a network request, so
    // it works under the app's strict Content-Security-Policy.
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    // Sanitise the room id into a safe filename.
    const safeRoom = roomId.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40) || "canvas"
    link.download = `whiteboard-${safeRoom}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    // Give the download a tick to start before releasing the blob.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, "image/png")
}
//#endregion
