//#region Why this exists
// Email addresses are the single most commonly breached field in the industry,
// and they are the pivot for everything that follows a breach: credential
// stuffing, phishing, and correlating one leak against another. Storing them in
// plaintext means a read-only database leak hands an attacker the whole list.
//
// But you cannot simply hash an email the way you hash a password, because you
// still have to LOOK USERS UP by it at login. That is the problem a blind index
// solves, and it is the whole design here:
//
//   email_index      = slowKdf(normalisedEmail, pepper)   <- searchable, one-way
//   email_ciphertext = AES-256-GCM(email, key, aad=userId) <- recoverable
//
// Two DIFFERENT secrets, both held outside the database:
//   * the pepper never decrypts anything, so leaking it only enables guessing;
//   * the encryption key never helps you search, so leaking it does not let you
//     confirm whether a given address is registered without also having the DB.
// Using one secret for both would collapse that separation for no benefit.
//
// WHY A SLOW KDF, NOT HMAC. This is the part that is easy to get wrong. HMAC is
// the usual advice for blind indexes and it is fine for HIGH-ENTROPY values. An
// email address is not high entropy — the realistic space is small and highly
// guessable. With a fast keyed hash, anyone holding the database and the pepper
// can enumerate the entire address space and confirm membership. A deliberately
// slow KDF makes each guess cost real time, turning "enumerate everyone" into a
// per-address expense. Paragon's guidance is explicit that sensitive, guessable
// plaintexts want a password-hashing function here rather than HMAC.
//
// WHY AAD = userId. AES-GCM authenticates its additional data, so binding the
// ciphertext to the row it belongs to means an attacker with write access cannot
// SWAP two users' ciphertexts to learn which is which — decryption of a moved
// ciphertext simply fails. This is why the user id must exist BEFORE encryption,
// and therefore why ids are generated in the application rather than by the
// database default.
//#endregion

//#region Imports
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto"
import { promisify } from "node:util"

import type { ScryptOptions } from "node:crypto"
//#endregion

//#region Constants
// promisify picks scrypt's 3-argument overload, so the options form has to be
// re-stated. Without this the N parameter silently could not be passed.
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>

const IS_PROD = process.env.NODE_ENV === "production"

// Lighter than the password KDF on purpose. This runs on every login IN ADDITION
// to the password hash, and its job is to make bulk enumeration expensive rather
// than to protect a high-value secret on its own. N=2^14 needs ~16 MB, which sits
// inside Node's default 32 MB scrypt maxmem — no tuning required.
const INDEX_SCRYPT_N = 16_384
const INDEX_KEY_LENGTH = 32

// AES-GCM standard nonce length. 96 bits is the size the mode is specified and
// optimised for; other lengths get re-hashed internally and buy nothing.
const IV_LENGTH = 12
const KEY_LENGTH = 32 // AES-256

// Versioned so a future key rotation can decrypt old values while writing new
// ones. Without this, rotating a key means an un-migratable column.
const FORMAT_VERSION = "v1"

// Dev-only fallbacks. Production REFUSES to start without real values (see
// below): a silent fallback there would mean shipping a build whose "encryption"
// uses a secret published in this source file.
const DEV_PEPPER = "dev-only-insecure-email-index-pepper"
const DEV_KEY_B64 = Buffer.alloc(KEY_LENGTH, 7).toString("base64")

let warned = false
//#endregion

//#region Key loading
function requireSecret(name: string, devFallback: string): string {
  const value = process.env[name]
  if (value && value.length > 0) {
    return value
  }
  if (IS_PROD) {
    // Fail CLOSED. An origin allowlist that is unset degrades to "no check",
    // which is recoverable; encryption keys that silently fall back to a
    // published constant are not — every address written would be readable by
    // anyone with this source. Refusing to boot is the only safe response.
    throw new Error(
      `${name} is not set. Refusing to start in production without it — ` +
        `email encryption would otherwise use a public development key.`,
    )
  }
  if (!warned) {
    warned = true
    console.warn(
      "WARNING: EMAIL_INDEX_PEPPER / EMAIL_ENCRYPTION_KEY are unset. Using " +
        "insecure development defaults. Never run this configuration anywhere real.",
    )
  }
  return devFallback
}

function pepper(): string {
  return requireSecret("EMAIL_INDEX_PEPPER", DEV_PEPPER)
}

function encryptionKey(): Buffer {
  const raw = requireSecret("EMAIL_ENCRYPTION_KEY", DEV_KEY_B64)
  const key = Buffer.from(raw, "base64")
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `EMAIL_ENCRYPTION_KEY must be ${KEY_LENGTH} bytes of base64 ` +
        `(got ${key.length}). Generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    )
  }
  return key
}
//#endregion

// Forces both secrets to be read NOW rather than at first use.
//
// The fail-closed check above is only as good as when it runs, and every caller
// of it is lazy: pepper() and encryptionKey() are reached from register, login
// and nothing else. A production deploy missing EMAIL_INDEX_PEPPER therefore
// booted cleanly, passed the health check (which deliberately touches nothing),
// took traffic, and threw on the first person who tried to sign up — surfacing
// as a generic 500 rather than as the refusal to start that was intended.
//
// server.ts calls this before listen(), which is what makes "refuses to boot"
// true rather than aspirational.
export function assertEmailSecretsPresent(): void {
  pepper()
  encryptionKey()
}
//#endregion

//#region Blind index
// Deterministic: the same address always produces the same index, which is what
// makes lookup possible. Normalisation happens in validateEmail (trim +
// lowercase) so "A@X.com" and "a@x.com" cannot become two accounts.
export async function emailBlindIndex(normalisedEmail: string): Promise<string> {
  const derived = (await scryptAsync(
    normalisedEmail,
    pepper(),
    INDEX_KEY_LENGTH,
    { N: INDEX_SCRYPT_N },
  )) as Buffer
  return derived.toString("hex")
}

// Constant-time comparison for anywhere two indexes are compared in application
// code. The database does its own comparison for lookups; this exists so no
// caller is tempted to use `===` and leak timing.
export function blindIndexEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex")
  const bufB = Buffer.from(b, "hex")
  if (bufA.length !== bufB.length) {
    return false
  }
  return timingSafeEqual(bufA, bufB)
}
//#endregion

//#region Encryption
// Format: v1.<iv>.<authTag>.<ciphertext>, all base64. Self-describing so the
// version can drive decryption, and greppable in a dump.
export function encryptEmail(normalisedEmail: string, userId: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv)
  // Bind to the row. GCM authenticates AAD without storing it, so a ciphertext
  // moved to another user's row fails to decrypt.
  cipher.setAAD(Buffer.from(userId, "utf8"))

  const ciphertext = Buffer.concat([
    cipher.update(normalisedEmail, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()

  return [
    FORMAT_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(".")
}

// Throws if the payload was tampered with, truncated, or moved to a different
// row — GCM authentication failing IS the tamper signal, so it must not be
// swallowed into a null.
export function decryptEmail(payload: string, userId: string): string {
  const parts = payload.split(".")
  if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
    throw new Error("Unrecognised email ciphertext format.")
  }

  const [, ivB64, tagB64, dataB64] = parts
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivB64, "base64"),
  )
  decipher.setAAD(Buffer.from(userId, "utf8"))
  decipher.setAuthTag(Buffer.from(tagB64, "base64"))

  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8")
}
//#endregion

//#region Identity
// User ids are generated HERE rather than by the database's gen_random_uuid()
// default, because the id is the AAD for the email ciphertext and therefore has
// to exist before the row is built. Same UUIDv4 source, just on this side of the
// wire.
export function newUserId(): string {
  return randomUUID()
}
//#endregion
