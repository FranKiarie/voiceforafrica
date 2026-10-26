import { formatDuration, LANGUAGES, VOICES, type Voice } from "../src/data"
import {
  KES_PER_MINUTE,
  MAX_PAYG_CHARS,
  MIN_SCRIPT_CHARS,
  normalizeScript,
  previewSource,
  quoteFor,
} from "../src/pricing"
import { splitScript } from "./audio"
import { ScriptRejected, speak, speakPreview } from "./gemini"
import {
  assessPayment,
  initializePayment,
  licenceIdOk,
  newLicenceId,
  refundPayment,
  sha256,
  signaturesMatch,
  verifyPayment,
} from "./paystack"
import { publishClip, recallClip } from "./store"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const hits = new Map<string, number[]>()
const inflight = new Map<string, Promise<StoredResult>>()

type StoredResult = { seconds: number; audioUrl: string; mime: string; licenceId: string }

const SAMPLE_SCRIPT =
  "Karibu. This is Mikaka Voice, from Nairobi. Paste your script, hear a Kenyan voice, then pay with M-Pesa only if you want the full clip."

function json(status: number, body: unknown, extra?: HeadersInit): Response {
  const headers = new Headers(extra)
  headers.set("content-type", "application/json; charset=utf-8")
  headers.set("cache-control", "no-store")
  return new Response(JSON.stringify(body), { status, headers })
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  return forwarded?.split(",")[0]?.trim() || "unknown"
}

function limited(ip: string, bucket: string, limit: number, windowMs: number): boolean {
  const key = `${bucket}:${ip}`
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs)
  if (recent.length >= limit) {
    hits.set(key, recent)
    return true
  }
  recent.push(now)
  hits.set(key, recent)
  return false
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length > 80_000) throw new HttpError(413, "That script is too long.")
  if (!text) return {}
  try {
    const body = JSON.parse(text) as unknown
    if (!body || typeof body !== "object") throw new Error("not an object")
    return body as Record<string, unknown>
  } catch {
    throw new HttpError(400, "The request was not valid JSON.")
  }
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  return typeof value === "string" ? value : ""
}

function voiceById(id: string): Voice | undefined {
  return VOICES.find((voice) => voice.id === id)
}

function originOf(request: Request): string {
  const configured = process.env.APP_URL?.replace(/\/+$/, "")
  if (configured) return configured
  const url = new URL(request.url)
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "")
  return `${proto}://${host}`
}

function keysReady(): { gemini: boolean; paystack: boolean } {
  return {
    gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY),
    paystack: Boolean(process.env.PAYSTACK_SECRET_KEY),
  }
}

const sampleCache = new Map<string, { bytes: Buffer; mime: string }>()

async function sample(request: Request): Promise<Response> {
  if (limited(clientIp(request), "sample", 40, 60 * 60 * 1000)) {
    return json(429, { detail: "Too many sample plays. Try again in a little while." })
  }
  const voiceId = new URL(request.url).searchParams.get("voice") || VOICES[0]!.id
  const voice = voiceById(voiceId)
  if (!voice) return json(400, { detail: "Unknown voice." })
  const cached = sampleCache.get(voice.id)
  if (cached) return audioResponse(cached.bytes, cached.mime)
  if (!keysReady().gemini) {
    console.error("Missing GEMINI_API_KEY")
    return json(503, { detail: "The sample isn't available right now. Please try again later." })
  }
  try {
    const spoken = await speakPreview(SAMPLE_SCRIPT, voice)
    sampleCache.set(voice.id, spoken)
    return audioResponse(spoken.bytes, spoken.mime)
  } catch (error) {
    if (error instanceof ScriptRejected) return json(400, { detail: "We couldn't play that sample." })
    console.error("Sample failed", error instanceof Error ? error.message : "unknown")
    return json(502, { detail: "We couldn't play that sample. Please try again." })
  }
}

function audioResponse(bytes: Buffer, mime: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      "content-type": mime,
      "cache-control": "public, max-age=86400",
    },
  })
}

async function preview(request: Request): Promise<Response> {
  if (limited(clientIp(request), "preview", 10, 60 * 60 * 1000)) {
    return json(429, { detail: "You've used the free previews for this hour. Try again later, or pay for the full clip." })
  }
  const body = await readJson(request)
  const script = normalizeScript(str(body, "script"))
  const voice = voiceById(str(body, "voiceId"))
  const language = str(body, "language")
  const email = str(body, "email").trim()
  if (!voice || !LANGUAGES.some((item) => item.code === language)) return json(400, { detail: "Choose a language and a voice." })
  if (script.length < MIN_SCRIPT_CHARS) return json(400, { detail: "Paste a little more of the script." })
  if (script.length > MAX_PAYG_CHARS) return json(400, { detail: "That script is longer than 5 minutes. Shorten it and try again." })
  if (!EMAIL_RE.test(email)) return json(400, { detail: "Enter an email address for the download." })
  if (!keysReady().gemini) {
    console.error("Missing GEMINI_API_KEY")
    return json(503, { detail: "Voice generation isn't available right now. Please try again later." })
  }
  try {
    const spoken = await speakPreview(previewSource(script), voice)
    return json(200, {
      previewId: `prev-${Date.now().toString(36)}`,
      seconds: spoken.seconds,
      audioUrl: `data:${spoken.mime};base64,${spoken.bytes.toString("base64")}`,
      mime: spoken.mime,
    })
  } catch (error) {
    if (error instanceof ScriptRejected) {
      return json(400, { detail: "We couldn't read this script aloud. Edit it and try again." })
    }
    console.error("Preview failed", error instanceof Error ? error.message : "unknown")
    return json(502, { detail: "We couldn't make your preview just now. Please try again." })
  }
}

async function checkout(request: Request): Promise<Response> {
  if (limited(clientIp(request), "checkout", 15, 60 * 60 * 1000)) {
    return json(429, { detail: "Too many payment attempts. Wait a few minutes and try again." })
  }
  const body = await readJson(request)
  const script = normalizeScript(str(body, "script"))
  const voice = voiceById(str(body, "voiceId"))
  const language = str(body, "language")
  const email = str(body, "email").trim().toLowerCase()
  if (!voice || !LANGUAGES.some((item) => item.code === language)) return json(400, { detail: "Choose a language and a voice." })
  if (script.length < MIN_SCRIPT_CHARS || script.length > MAX_PAYG_CHARS) {
    return json(400, { detail: "That script can't be priced. Check the length and try again." })
  }
  if (!EMAIL_RE.test(email)) return json(400, { detail: "Enter an email address for the receipt." })
  if (!keysReady().paystack) {
    console.error("Missing PAYSTACK_SECRET_KEY")
    return json(503, { detail: "Payments aren't available right now. Please try again later." })
  }
  const quote = quoteFor(script)
  const reference = newLicenceId()
  const origin = originOf(request)
  const callbackUrl = origin.startsWith("https://") ? `${origin}/pay` : undefined
  try {
    const payment = await initializePayment({
      email,
      amountKes: quote.kes,
      reference,
      callbackUrl,
      metadata: {
        product: "mikaka-voice",
        voice_id: voice.id,
        voice_name: voice.name,
        language,
        script_sha256: sha256(script),
        projected_seconds: String(quote.projectedSeconds),
        amount_kes: String(quote.kes),
        billed_minutes: String(quote.billedMinutes),
      },
    })
    return json(200, { jobId: payment.reference, amountKes: quote.kes, accessCode: payment.accessCode })
  } catch {
    return json(502, { detail: "We couldn't open M-Pesa or card checkout. Please try again." })
  }
}

async function makeClip(reference: string, script: string, voice: Voice): Promise<StoredResult> {
  const existing = await recallClip(reference)
  if (existing) return { seconds: existing.seconds, audioUrl: existing.url, mime: existing.mime, licenceId: reference }
  const running = inflight.get(reference)
  if (running) return running
  const job = (async () => {
    const again = await recallClip(reference)
    if (again) return { seconds: again.seconds, audioUrl: again.url, mime: again.mime, licenceId: reference }
    const pcm = await speak(voice, splitScript(script))
    const stored = await publishClip(reference, pcm)
    return { seconds: stored.seconds, audioUrl: stored.url, mime: stored.mime, licenceId: reference }
  })()
  inflight.set(reference, job)
  try {
    return await job
  } finally {
    inflight.delete(reference)
  }
}

async function claim(request: Request): Promise<Response> {
  const body = await readJson(request)
  const reference = str(body, "reference").toUpperCase()
  const script = normalizeScript(str(body, "script"))
  const voice = voiceById(str(body, "voiceId"))
  const language = str(body, "language")
  if (!licenceIdOk(reference)) return json(400, { detail: "That payment reference is not one of ours." })
  if (!voice || !LANGUAGES.some((item) => item.code === language)) return json(400, { detail: "Choose a language and a voice." })
  if (script.length < MIN_SCRIPT_CHARS || script.length > MAX_PAYG_CHARS) {
    return json(400, { detail: "The script no longer matches the one you paid for." })
  }
  if (!keysReady().paystack || !keysReady().gemini) {
    console.error("Missing payment or Gemini key")
    return json(503, { detail: "We can't finish this clip right now. Please try again later." })
  }
  let tx
  try {
    tx = await verifyPayment(reference)
  } catch {
    return json(502, { detail: "We couldn't confirm the payment with Paystack. Keep this page open and try again." })
  }
  if (!tx) return json(200, { jobId: reference, status: "failed", error: "We couldn't find that payment." })
  const verdict = assessPayment(tx, { scriptHash: sha256(script), voiceId: voice.id, language })
  if (verdict === "pending") return json(200, { jobId: reference, status: "paying" })
  if (verdict === "failed") {
    return json(200, { jobId: reference, status: "failed", error: "Payment was not finished. Nothing was charged." })
  }
  if (verdict === "mismatch") {
    return json(200, {
      jobId: reference,
      status: "failed",
      error: "This payment doesn't match the script and voice on this page. Open the tab where you paid, or start again.",
    })
  }
  try {
    const clip = await makeClip(reference, script, voice)
    return json(200, { jobId: reference, status: "ready", ...clip })
  } catch (error) {
    if (error instanceof ScriptRejected) {
      const refunded = await refundPayment(reference)
      return json(200, {
        jobId: reference,
        status: "failed",
        refunded,
        error: refunded
          ? "We couldn't read this script aloud, so the payment was refunded."
          : "We couldn't read this script aloud. Email support@mikaka.io with your reference and we will refund you.",
      })
    }
    console.error("Full clip failed", reference, error instanceof Error ? error.message : "unknown")
    const refunded = await refundPayment(reference)
    return json(200, {
      jobId: reference,
      status: "failed",
      refunded,
      error: refunded
        ? "The clip failed and the payment was refunded. You can try again from the studio."
        : `The clip failed after payment. Email support@mikaka.io with ${reference} and we will refund you.`,
    })
  }
}

async function verifyLicence(id: string): Promise<Response> {
  const licenceId = id.toUpperCase()
  if (!licenceIdOk(licenceId)) return json(400, { detail: "That does not look like a licence ID." })
  if (!keysReady().paystack) return json(503, { detail: "Licence checks aren't available right now." })
  let tx
  try {
    tx = await verifyPayment(licenceId)
  } catch {
    return json(502, { detail: "We couldn't reach the licence service." })
  }
  if (!tx || assessLoose(tx) !== "ok") return json(404, { detail: "Not found" })
  const voice = voiceById(tx.metadata.voice_id)
  const seconds = Number(tx.metadata.projected_seconds)
  return json(200, {
    id: licenceId,
    tier: "Commercial",
    voice: tx.metadata.voice_name || voice?.name || "Mikaka Voice",
    length: formatDuration(Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0),
    issued: tx.paidAt || new Date().toISOString(),
    paidKes: Number(tx.metadata.amount_kes) || undefined,
  })
}

/** Public check: a successful Mikaka payment, without needing the script again. */
function assessLoose(tx: { status: string; metadata: Record<string, string>; currency: string; amount: number }): "ok" | "no" {
  if (tx.status.toLowerCase() !== "success") return "no"
  if (tx.metadata.product !== "mikaka-voice") return "no"
  if (tx.currency.toUpperCase() !== "KES") return "no"
  const recorded = Number(tx.metadata.amount_kes)
  if (!Number.isFinite(recorded) || tx.amount !== Math.round(recorded * 100)) return "no"
  return "ok"
}

async function webhook(request: Request): Promise<Response> {
  const secret = process.env.PAYSTACK_SECRET_KEY
  if (!secret) return json(503, { detail: "Payments aren't configured." })
  const raw = await request.text()
  const signature = request.headers.get("x-paystack-signature") || ""
  if (!signaturesMatch(raw, signature, secret)) return json(401, { detail: "Invalid signature" })
  // The clip is released only by claim(), which calls Paystack's verify API.
  // A webhook alone never returns audio.
  return json(200, { received: true })
}

function health(): Response {
  const keys = keysReady()
  return json(200, {
    ok: keys.gemini && keys.paystack,
    gemini: keys.gemini,
    paystack: keys.paystack,
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    priceKesPerMinute: KES_PER_MINUTE,
  })
}

function notOnSale(): Response {
  return json(501, { detail: "Accounts and monthly plans are not on sale yet. Pay per clip from the studio." })
}

export async function handleApi(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.replace(/\/+$/, "") || "/"
  const method = request.method.toUpperCase()
  try {
    if (path === "/api/v1/voice-studio/health" && method === "GET") return health()
    if (path === "/api/v1/voice-studio/sample" && method === "GET") return sample(request)
    if (path === "/api/v1/voice-studio/previews" && method === "POST") return preview(request)
    if (path === "/api/v1/voice-studio/payg/checkout" && method === "POST") return checkout(request)
    if (path === "/api/v1/voice-studio/jobs/claim" && method === "POST") return claim(request)
    if (path === "/api/v1/voice-studio/webhooks/paystack" && method === "POST") return webhook(request)
    const licence = path.match(/^\/api\/v1\/voice-studio\/verify\/([^/]+)$/)
    if (licence && method === "GET") return verifyLicence(decodeURIComponent(licence[1] || ""))
    if (
      (path === "/api/v1/voice-studio/auth/magic-link" && method === "POST") ||
      (path === "/api/v1/voice-studio/clips" && method === "GET") ||
      (path === "/api/v1/voice-studio/plans/checkout" && method === "POST") ||
      (/^\/api\/v1\/voice-studio\/plans\/[^/]+$/.test(path) && method === "GET")
    ) {
      return notOnSale()
    }
    return json(404, { detail: "Not found" })
  } catch (error) {
    if (error instanceof HttpError) return json(error.status, { detail: error.message })
    console.error("API error", error instanceof Error ? error.message : "unknown")
    return json(500, { detail: "Something went wrong. Please try again." })
  }
}
