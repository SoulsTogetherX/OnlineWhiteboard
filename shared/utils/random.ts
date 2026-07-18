//#region Deterministic PRNG
// mulberry32: a tiny, fast, well-distributed seeded PRNG. The point is
// DETERMINISM — the same seed produces the exact same sequence of numbers on
// every machine. That is what makes the spray can safe to send over the wire:
// the instruction carries only a `seed`, and the server plus every client run
// this identically to scatter pixels in the same places. Sending the pixel list
// would be far larger and would defeat the "instructions, not pixels" design.
//
// Math.random() could NOT be used inside the draw code for this reason — it
// isn't seedable, so two clients would paint different splatters from the same
// instruction and desync. Math.random() is fine for CHOOSING a seed on the
// client (that value is then transmitted); it must never drive the shared apply.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
//#endregion

//#region Seed
// A fresh 32-bit seed for one spray puff, chosen on the client. Only the value
// travels; determinism comes from mulberry32 above, not from where the seed
// came from — so Math.random() here is correct and intended.
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000)
}
//#endregion
