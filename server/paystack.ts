import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const API = "https://api.paystack.co"

export type Tx = {
  status: string
  amount: number
  currency: string
  paidAt: string
  metadata: Record<string, string>
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex")
}

export function newLicenceId(now = new Date()): string {
  const bytes = randomBytes(6)
  let code = ""
  for (let i = 0; i < 6; i++) code += ALPHABET[bytes[i]! % ALPHABET.length]
  return `VS-${now.getFullYear()}-${code}`
}

export function licenceIdOk(id: string): boolean {
  return /^VS-\d{4}-[A-Z0-9]{6}$/i.test(id)
}

export function signaturesMatch(raw: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha512", secret).update(raw, "utf8").digest("hex")
  const a = Buffer.from(expected, "utf8")
  const b = Buffer.from(signature.trim(), "utf8")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function secret(): string {
  const key = process.env.PAYSTACK_SECRET_KEY
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not set")
  return key
}

async function paystack(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { ok: res.ok, status: res.status, body }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function metadataStrings(raw: unknown): Record<string, string> {
  let value = raw
  if (typeof value === "string" && value.trim().startsWith("{")) {
    try {
      value = JSON.parse(value)
    } catch {
      value = {}
    }
  }
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(asRecord(value))) {
    if (typeof item === "string" || typeof item === "number") out[key] = String(item)
  }
  return out
}

export async function initializePayment(input: {
  email: string
  amountKes: number
  reference: string
  callbackUrl?: string
  metadata: Record<string, string>
}): Promise<{ accessCode: string; reference: string }> {
  const payload: Record<string, unknown> = {
    email: input.email,
    amount: input.amountKes * 100,
    currency: "KES",
    reference: input.reference,
    metadata: {
      ...input.metadata,
      custom_fields: [
        { display_name: "Licence", variable_name: "licence", value: input.reference },
        { display_name: "Voice", variable_name: "voice", value: input.metadata.voice_name ?? "" },
        { display_name: "Minutes", variable_name: "minutes", value: input.metadata.billed_minutes ?? "" },
      ],
    },
  }
  if (input.callbackUrl) payload.callback_url = input.callbackUrl
  const { ok, body } = await paystack("/transaction/initialize", { method: "POST", body: JSON.stringify(payload) })
  const data = asRecord(asRecord(body).data)
  const accessCode = data.access_code
  if (!ok || typeof accessCode !== "string" || !accessCode) {
    console.error("Paystack initialize failed", asRecord(body).message ?? "unknown")
    throw new Error("Could not start the payment")
  }
  return { accessCode, reference: typeof data.reference === "string" ? data.reference : input.reference }
}

export async function verifyPayment(reference: string): Promise<Tx | null> {
  const { ok, status, body } = await paystack(`/transaction/verify/${encodeURIComponent(reference)}`)
  if (!ok) {
    if (status === 400 || status === 404) return null
    console.error("Paystack verify failed", status, asRecord(body).message ?? "")
    throw new Error("Could not check the payment")
  }
  const data = asRecord(asRecord(body).data)
  const amount = typeof data.amount === "number" ? data.amount : Number(data.amount)
  if (typeof data.status !== "string" || !Number.isFinite(amount)) return null
  return {
    status: data.status,
    amount,
    currency: typeof data.currency === "string" ? data.currency : "",
    paidAt: typeof data.paid_at === "string" ? data.paid_at : "",
    metadata: metadataStrings(data.metadata),
  }
}

export async function refundPayment(reference: string): Promise<boolean> {
  try {
    const { ok, body } = await paystack("/refund", {
      method: "POST",
      body: JSON.stringify({ transaction: reference }),
    })
    if (!ok) console.error("Paystack refund failed", asRecord(body).message ?? "")
    return ok && asRecord(body).status === true
  } catch (error) {
    console.error("Paystack refund error", error instanceof Error ? error.message : "unknown")
    return false
  }
}

export type PaymentVerdict = "ok" | "pending" | "failed" | "mismatch"

const PENDING = new Set(["pending", "ongoing", "processing", "queued", "pay_offline"])

/** The browser never sets the price. The shillings on the Paystack transaction must be the ones we stored. */
export function assessPayment(
  tx: Tx,
  input: { scriptHash: string; voiceId: string; language: string },
): PaymentVerdict {
  const status = tx.status.toLowerCase()
  if (PENDING.has(status)) return "pending"
  if (status !== "success") return "failed"
  const recorded = Number(tx.metadata.amount_kes)
  if (!Number.isFinite(recorded) || recorded <= 0) return "mismatch"
  if (tx.currency.toUpperCase() !== "KES") return "mismatch"
  if (tx.amount !== Math.round(recorded * 100)) return "mismatch"
  if (tx.metadata.product !== "mikaka-voice") return "mismatch"
  if (tx.metadata.script_sha256 !== input.scriptHash) return "mismatch"
  if (tx.metadata.voice_id !== input.voiceId) return "mismatch"
  if (tx.metadata.language !== input.language) return "mismatch"
  return "ok"
}
