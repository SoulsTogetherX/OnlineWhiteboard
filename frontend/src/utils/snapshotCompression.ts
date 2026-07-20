//#region Why this exists
// The client half of the snapshot payload codec. The server deflates the pixels
// (backend/src/sockets/snapshotCompression.ts); this inflates them.
//
// Unlike the draw algorithms, this pair is deliberately NOT in shared/. The two
// halves cannot share an implementation: the server has node:zlib and the
// browser has DecompressionStream, and neither exists in the other. What they
// share is the FORMAT, which lives in shared/ as SnapshotCompression — the thing
// they could actually disagree about.
//
// DecompressionStream is a platform API, so this costs no dependency (§12.6
// prefers the platform, which is also why scrypt and the native WebSocket are
// used elsewhere).
//
// It is also asynchronous, with no synchronous alternative in the browser. That
// is not merely inconvenient: it means a snapshot can no longer be applied in
// the same turn it arrives, so draws that land mid-inflate could otherwise be
// overwritten by a snapshot older than they are. useRoomConnection serialises
// canvas work through one promise chain to preserve arrival order — see the
// comment there.
//#endregion

//#region Imports
import type { SnapshotCompression } from "@shared/types/socketProtocol"
//#endregion

//#region Decompression
// Returns the raw RGBA bytes, or null if the payload could not be inflated.
// Null is treated exactly like a malformed frame: drop it and let the next
// revision_check trigger a fresh snapshot. A corrupt canvas is worse than a
// stale one.
export async function decompressSnapshotPayload(
  payload: Uint8Array,
  compression: SnapshotCompression,
): Promise<Uint8Array | null> {
  if (compression === "none") {
    return payload
  }

  if (compression !== "deflate-raw") {
    // An unknown algorithm from a newer server. Drop rather than guess.
    return null
  }

  try {
    const stream = new Blob([payload as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("deflate-raw"))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}
//#endregion
