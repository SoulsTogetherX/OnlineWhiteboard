//#region Why this exists
// The one place the backend sends email. Two messages go through it — the
// verification link and the password-reset link — and everything security- and
// abuse-relevant about sending is centralised here so a route cannot get it
// wrong:
//
//   * Links are built from PUBLIC_SITE_URL, a SERVER-controlled env value, never
//     from the request's Host header. Building a reset link from an
//     attacker-supplied Host is the classic "password-reset poisoning" bug — the
//     victim gets a real email pointing at the attacker's domain. We never read
//     the request here, so that class of bug cannot occur.
//   * The only user-controlled string that reaches a message body is the display
//     name, and it is HTML-escaped before it goes into the HTML part. The token
//     is URL-encoded into the link. Recipient addresses come from our own
//     decrypted store, not from the request body.
//   * The transport is OPTIONAL. Email verification and password reset are
//     enhancements — nothing in the app requires a verified address (login and
//     drawing work regardless) — so a deploy without SMTP is a valid choice, not
//     a misconfiguration to fail closed on. That is the key difference from the
//     email-at-rest secrets (assertEmailSecretsPresent), which EVERY account
//     depends on and which do refuse to boot. So warnIfMailerUnconfigured only
//     WARNS, in every environment: the server starts, and with no SMTP the
//     verification/reset links are logged to the console instead of emailed —
//     which also lets the whole flow be exercised locally with no mail server.
//#endregion

//#region Imports
import nodemailer, { type Transporter } from "nodemailer"
import { log } from "@/observability/log"
//#endregion

//#region Config
// The site origin the links point at. In dev this is the Vite server
// (http://localhost:5173), which proxies /api to the backend; in prod it is the
// real origin, which nginx serves and proxies from. Either way it is the origin
// the browser loads the app from, so a same-origin link works without CORS.
function siteUrl(): string {
  return (process.env.PUBLIC_SITE_URL ?? "http://localhost:5173").replace(
    /\/+$/,
    "",
  )
}

type SmtpConfig = {
  host: string
  port: number
  secure: boolean
  user?: string
  pass?: string
  from: string
}

// Reads SMTP settings from the environment, or null if the minimum (a host and a
// from-address) is not configured — the signal to fall back to console logging
// in dev.
function readSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST
  const from = process.env.EMAIL_FROM
  if (!host || host.length === 0 || !from || from.length === 0) {
    return null
  }
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD
  return {
    host,
    // 587 (STARTTLS submission) is the common default; SMTP_SECURE=true selects
    // the implicit-TLS 465 path instead.
    port: Number(process.env.SMTP_PORT ?? "587"),
    secure: process.env.SMTP_SECURE === "true",
    user: user && user.length > 0 ? user : undefined,
    pass: pass && pass.length > 0 ? pass : undefined,
    from,
  }
}

// Called from server.ts before listen(). Never fatal: email verification and
// password reset are optional (nothing in the app requires a verified address),
// so a deploy without SMTP boots normally — it just cannot deliver those two
// emails, and logs their links to the console instead (see send). This is
// deliberately NOT the fail-closed stance of assertEmailSecretsPresent, because
// those secrets are load-bearing for every account while this transport is not.
export function warnIfMailerUnconfigured(): void {
  if (readSmtpConfig()) {
    return
  }
  log.warn(
    "SMTP is not configured (SMTP_HOST / EMAIL_FROM). Email " +
      "verification and password reset are disabled — their links are logged to " +
      "this console instead of emailed. Set SMTP_HOST and EMAIL_FROM to deliver mail.",
  )
}
//#endregion

//#region Transport
// Built once, lazily, and reused. nodemailer pools nothing by default here; a
// single transporter is the documented way to reuse the connection settings.
let transporter: Transporter | null = null
let transporterKey = ""

function getTransport(config: SmtpConfig): Transporter {
  // Rebuild only if the config changed (it never does at runtime, but this keeps
  // the memoisation honest rather than assuming).
  const key = `${config.host}:${config.port}:${config.secure}:${config.user ?? ""}`
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    })
    transporterKey = key
  }
  return transporter
}
//#endregion

//#region Escaping
// The display name is the one user-controlled value that reaches an HTML body.
// Escape it so a name like `<img onerror=…>` can't become markup in a mail
// client. The plaintext part needs no escaping.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
//#endregion

//#region Sending
type Message = { subject: string; text: string; html: string }

// The actual dispatch. In dev with no SMTP it logs the message (including the
// link, which is the whole point locally) and returns; in prod it sends. A send
// failure is logged and swallowed so the caller's generic success response is
// unchanged — whether a mail was delivered must not be observable to the client,
// and a transient SMTP blip should not surface as a 500 that reveals the address
// existed.
async function send(to: string, message: Message): Promise<void> {
  const config = readSmtpConfig()
  if (!config) {
    // Deliberately includes the address and full body: when SMTP is unset
    // this log line IS the delivery mechanism (see .env.example) — the
    // operator clicks the link out of the console.
    log.info("SMTP not configured; logging email instead of sending", {
      to,
      subject: message.subject,
      body: message.text,
    })
    return
  }
  try {
    await getTransport(config).sendMail({
      from: config.from,
      to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })
  } catch (error) {
    // Log the failure without the recipient in a way that could leak it broadly;
    // the address is the user's own and already known here, but keep the line
    // terse and never include the token.
    const e = error as { message?: string; code?: string }
    log.error("mail send failed", { code: e.code, message: e.message })
  }
}

// Email verification. The link hits the backend GET endpoint (proxied under
// /api), which redeems the token and confirms — no app UI needed to land on.
export async function sendVerificationEmail(
  to: string,
  username: string,
  token: string,
): Promise<void> {
  const link = `${siteUrl()}/api/auth/verify-email?token=${encodeURIComponent(token)}`
  const name = escapeHtml(username)
  await send(to, {
    subject: "Verify your email · Online Whiteboard",
    text:
      `Hi ${username},\n\n` +
      `Confirm your email address for Online Whiteboard by opening this link:\n` +
      `${link}\n\n` +
      `The link expires in 24 hours. If you didn't create an account, you can ` +
      `ignore this email.`,
    html:
      `<p>Hi ${name},</p>` +
      `<p>Confirm your email address for Online Whiteboard:</p>` +
      `<p><a href="${link}">Verify my email</a></p>` +
      `<p>The link expires in 24 hours. If you didn't create an account, you ` +
      `can ignore this email.</p>`,
  })
}

// Password reset. The link lands on the app itself (?reset=<token>), which opens
// the "set a new password" form and posts the token back to /api/auth/reset-password.
export async function sendPasswordResetEmail(
  to: string,
  username: string,
  token: string,
): Promise<void> {
  const link = `${siteUrl()}/?reset=${encodeURIComponent(token)}`
  const name = escapeHtml(username)
  await send(to, {
    subject: "Reset your password · Online Whiteboard",
    text:
      `Hi ${username},\n\n` +
      `We received a request to reset your Online Whiteboard password. Open ` +
      `this link to choose a new one:\n${link}\n\n` +
      `The link expires in 1 hour. If you didn't request this, you can ignore ` +
      `this email — your password will not change.`,
    html:
      `<p>Hi ${name},</p>` +
      `<p>We received a request to reset your Online Whiteboard password.</p>` +
      `<p><a href="${link}">Choose a new password</a></p>` +
      `<p>The link expires in 1 hour. If you didn't request this, you can ` +
      `ignore this email — your password will not change.</p>`,
  })
}
//#endregion
