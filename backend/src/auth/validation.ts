//#region Request validation
// Hand-written validators for the auth request bodies. Kept deliberately simple
// and dependency-free (the project validates socket input by hand too). They
// return either a normalised value or an error message, so a route can turn a
// bad request into a 400 with a useful reason.
//#endregion

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string }

// Intentionally permissive — the real proof an address exists is a verification
// email (future work). This just rejects obvious nonsense and normalises case so
// "A@x.com" and "a@x.com" are the same account.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateEmail(input: unknown): Validated<string> {
  if (typeof input !== "string") {
    return { ok: false, error: "Email is required." }
  }
  const email = input.trim().toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return { ok: false, error: "Enter a valid email address." }
  }
  return { ok: true, value: email }
}

// A tiny blocklist of the passwords that dominate every breach corpus. This is
// a floor, not a substitute for the real thing: the proper defence is checking
// the candidate against a breached-password set (e.g. the Have I Been Pwned
// range API, which uses k-anonymity so the password never leaves the server) —
// noted as future work because it needs an outbound network call.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwerty123", "qwertyuiop", "1q2w3e4r", "iloveyou", "admin123", "letmein",
  "welcome1", "monkey123", "abc12345", "111111111", "000000000", "sunshine",
  "princess", "football", "baseball", "trustno1", "dragon123", "passw0rd",
  "changeme", "whiteboard",
])

export function validatePassword(input: unknown): Validated<string> {
  if (typeof input !== "string") {
    return { ok: false, error: "Password is required." }
  }
  // Length is the single biggest factor in password strength; 8 is a floor, and
  // an upper bound matters because scrypt hashes the whole input and a
  // megabyte-long "password" is a cheap denial-of-service.
  if (input.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." }
  }
  if (input.length > 200) {
    return { ok: false, error: "Password must be at most 200 characters." }
  }
  if (COMMON_PASSWORDS.has(input.toLowerCase())) {
    return {
      ok: false,
      error: "That password is too common — please choose another.",
    }
  }
  return { ok: true, value: input }
}

export function validateUsername(input: unknown): Validated<string> {
  if (typeof input !== "string") {
    return { ok: false, error: "Username is required." }
  }
  const username = input.trim()
  if (username.length < 2 || username.length > 32) {
    return { ok: false, error: "Username must be 2–32 characters." }
  }
  return { ok: true, value: username }
}
//#endregion
