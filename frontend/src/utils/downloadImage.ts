//#region Export formats
// The drawing canvas is small internally (a room is 256² by default), so
// exporting it directly gives a postage stamp. Everything below scales it onto
// an offscreen canvas with image smoothing OFF, so the pixel art stays crisp
// (nearest-neighbour) rather than turning into a blurry mess.
const EXPORT_SCALE = 8

// The colour JPEG and BMP composite onto, since neither can store transparency.
// White rather than black: an unpainted board is conceptually paper.
const MATTE = "#ffffff"

export type ExportFormat = "png" | "webp" | "jpeg" | "bmp"

export interface ExportFormatDescriptor {
  id: ExportFormat
  label: string
  extension: string
  // What the user gives up by choosing it, or null when there is no catch.
  caveat: string | null
}

export const EXPORT_FORMATS: ExportFormatDescriptor[] = [
  {
    id: "png",
    label: "PNG",
    extension: "png",
    caveat: null,
  },
  {
    id: "webp",
    label: "WebP",
    extension: "webp",
    caveat: null,
  },
  {
    id: "jpeg",
    label: "JPEG",
    extension: "jpg",
    caveat: "No transparency — flattened onto white",
  },
  {
    id: "bmp",
    label: "Bitmap",
    extension: "bmp",
    caveat: "No transparency, large file",
  },
]
//#endregion

//#region Helpers
// The canvas scaled up for export. Shared by every format so they all get the
// same nearest-neighbour treatment.
//
// `matte` fills the canvas before drawing for formats that cannot store alpha:
// without it, a transparent pixel encodes as BLACK in JPEG, so an unpainted
// board would export as a black rectangle.
function scaledCanvas(
  source: HTMLCanvasElement,
  matte: string | null,
): HTMLCanvasElement | null {
  const scaled = document.createElement("canvas")
  scaled.width = source.width * EXPORT_SCALE
  scaled.height = source.height * EXPORT_SCALE

  const ctx = scaled.getContext("2d")
  if (!ctx) {
    return null
  }

  if (matte) {
    ctx.fillStyle = matte
    ctx.fillRect(0, 0, scaled.width, scaled.height)
  }

  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, 0, 0, scaled.width, scaled.height)
  return scaled
}

// A blob: URL + <a download> saves without a network request, so it works under
// the app's strict Content-Security-Policy.
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Give the download a tick to start before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function safeFilename(roomId: string, extension: string): string {
  const safeRoom = roomId.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40) || "canvas"
  return `whiteboard-${safeRoom}.${extension}`
}

// Encodes a canvas as an uncompressed 24-bit BMP.
//
// Hand-written because canvas.toBlob has no BMP encoder — no browser ships one,
// since BMP is a 1990 Windows format with no compression. It is here because it
// is the format that opens in absolutely anything, including tooling old enough
// to predate PNG.
//
// The layout is the classic BITMAPINFOHEADER form: a 14-byte file header, a
// 40-byte info header, then pixel rows BOTTOM-UP in BGR order, each row padded
// to a 4-byte boundary. All three of those are the parts people get wrong.
function encodeBmp(canvas: HTMLCanvasElement): Blob | null {
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    return null
  }
  const { width, height } = canvas
  const rgba = ctx.getImageData(0, 0, width, height).data

  // Rows are padded up to a multiple of 4 bytes — not pixels.
  const rowSize = Math.floor((24 * width + 31) / 32) * 4
  const pixelBytes = rowSize * height
  const fileSize = 54 + pixelBytes

  const buffer = new ArrayBuffer(fileSize)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // File header. Multi-byte fields are LITTLE-endian throughout (the `true`).
  bytes[0] = 0x42 // 'B'
  bytes[1] = 0x4d // 'M'
  view.setUint32(2, fileSize, true)
  view.setUint32(10, 54, true) // pixel data offset

  // BITMAPINFOHEADER
  view.setUint32(14, 40, true) // header size
  view.setInt32(18, width, true)
  view.setInt32(22, height, true) // positive = bottom-up
  view.setUint16(26, 1, true) // colour planes
  view.setUint16(28, 24, true) // bits per pixel
  view.setUint32(34, pixelBytes, true)
  // 2835 px/m ≈ 72 DPI, the conventional default.
  view.setInt32(38, 2835, true)
  view.setInt32(42, 2835, true)

  for (let y = 0; y < height; y += 1) {
    // Bottom-up: the LAST canvas row is written first.
    const sourceRow = height - 1 - y
    let out = 54 + y * rowSize
    for (let x = 0; x < width; x += 1) {
      const i = (sourceRow * width + x) * 4
      // BGR, not RGB.
      bytes[out] = rgba[i + 2]
      bytes[out + 1] = rgba[i + 1]
      bytes[out + 2] = rgba[i]
      out += 3
    }
    // The padding bytes are already zero from the ArrayBuffer.
  }

  return new Blob([buffer], { type: "image/bmp" })
}
//#endregion

//#region Download
// Saves the canvas in the chosen format.
//
// Resolves once the save has been triggered so a caller can close its menu; it
// does NOT resolve to whether the file was actually written, which the browser
// never tells us.
export function downloadCanvasImage(
  source: HTMLCanvasElement,
  roomId: string,
  format: ExportFormat = "png",
): Promise<void> {
  const descriptor =
    EXPORT_FORMATS.find((entry) => entry.id === format) ?? EXPORT_FORMATS[0]
  const filename = safeFilename(roomId, descriptor.extension)

  // JPEG and BMP have no alpha channel, so they get the matte.
  const needsMatte = format === "jpeg" || format === "bmp"
  const scaled = scaledCanvas(source, needsMatte ? MATTE : null)
  if (!scaled) {
    return Promise.resolve()
  }

  if (format === "bmp") {
    const blob = encodeBmp(scaled)
    if (blob) {
      saveBlob(blob, filename)
    }
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    scaled.toBlob(
      (blob) => {
        if (blob) {
          saveBlob(blob, filename)
        }
        resolve()
      },
      `image/${format}`,
      // Quality applies to the lossy formats only; ignored for PNG.
      0.92,
    )
  })
}
//#endregion
