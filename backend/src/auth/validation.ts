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
