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
//   * In production the transport is REQUIRED (assertMailerConfigured, called at
//     startup): a deploy where reset mail silently vanishes locks users out, so
//     it fails closed like the email-at-rest secrets. In development, with no
//     SMTP configured, it logs the link to the server console instead of sending
//     — which is what lets the whole flow be exercised locally with no mail
//     server, mirroring the dev fallbacks elsewhere in auth.
//#endregion

//#region Imports
import nodemailer, { type Transporter } from "nodemailer"
//#endregion

//#region Config
const IS_PROD = process.env.NODE_ENV === "production"

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

// Called from server.ts before listen(). In production a missing transport is
// fatal — the same fail-closed stance as assertEmailSecretsPresent, because a
// prod build that cannot send is one where password reset silently does nothing
// and users lock themselves out. In dev it only warns, so a fresh clone runs.
export function assertMailerConfigured(): void {
  if (readSmtpConfig()) {
    return
  }
  if (IS_PROD) {
    throw new Error(
      "SMTP is not configured (SMTP_HOST / EMAIL_FROM). Refusing to start in " +
        "production: email verification and password reset would silently fail.",
    )
  }
  console.warn(
    "WARNING: SMTP is not configured. Verification and password-reset links " +
      "will be logged to this console instead of emailed. Development only.",
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
    console.log(
      `[mailer:dev] would send "${message.subject}" to ${to}\n${message.text}`,
    )
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
    console.error(`mail send failed: ${e.code ?? ""} ${e.message ?? ""}`.trim())
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
