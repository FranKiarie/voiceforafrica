import assert from "node:assert/strict"
import { wrapWav } from "./audio"
import { handleApi } from "./handlers"
import { sha256 } from "./paystack"

process.env.GEMINI_API_KEY = "test-gemini"
process.env.PAYSTACK_SECRET_KEY = "sk_test_dummy"
delete process.env.BLOB_READ_WRITE_TOKEN

const script = "Hello from Nairobi, this is a short test."
const hash = sha256(script)
const reference = "VS-2026-TEST01"
const calls: string[] = []

const wav = wrapWav({ samples: Buffer.alloc(2400, 1), sampleRate: 24000 }).toString("base64")

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  calls.push(`${init?.method ?? "GET"} ${url}`)
  if (url.includes("/transaction/initialize")) {
    const sent = JSON.parse(String(init?.body)) as { amount: number; currency: string; metadata: { script_sha256: string } }
    assert.equal(sent.amount, 19500)
    assert.equal(sent.currency, "KES")
    assert.equal(sent.metadata.script_sha256, hash)
    return json({ status: true, data: { access_code: "AC_test", reference } })
  }
  if (url.includes("/transaction/verify/")) {
    const paid = !url.endsWith("VS-2026-UNPAID")
    return json({
      status: true,
      data: {
        status: paid ? "success" : "abandoned",
        amount: 19500,
        currency: "KES",
        paid_at: "2026-10-27T08:00:00.000Z",
        metadata: {
          product: "mikaka-voice",
          script_sha256: hash,
          voice_id: "sw-ke-csagent-4",
          language: "en",
          amount_kes: "195",
          voice_name: "Call Centre Agent 4",
          projected_seconds: "3",
        },
      },
    })
  }
  if (url.includes("generativelanguage")) {
    return json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/wav", data: wav } }] } }] })
  }
  if (url.includes("/refund")) return json({ status: true })
  return json({ message: "unexpected" }, 404)
}

async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await handleApi(
    new Request(`https://voice.mikaka.io${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.10" },
      body: JSON.stringify(body),
    }),
  )
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

const checkout = await post("/api/v1/voice-studio/payg/checkout", {
  script,
  voiceId: "sw-ke-csagent-4",
  language: "en",
  email: "buyer@example.com",
  amountKes: 1,
})
assert.equal(checkout.status, 200)
assert.equal(checkout.json.amountKes, 195)
assert.equal(checkout.json.accessCode, "AC_test")
assert.equal(calls.some((call) => call.includes("generativelanguage")), false)

calls.length = 0
const unpaid = await post("/api/v1/voice-studio/jobs/claim", {
  reference: "VS-2026-UNPAID",
  script,
  voiceId: "sw-ke-csagent-4",
  language: "en",
})
assert.equal(unpaid.json.status, "failed")
assert.equal(unpaid.json.audioUrl, undefined)
assert.equal(calls.some((call) => call.includes("generativelanguage")), false)

calls.length = 0
const swapped = await post("/api/v1/voice-studio/jobs/claim", {
  reference,
  script: "A completely different script that was never paid for, thank you.",
  voiceId: "sw-ke-csagent-4",
  language: "en",
})
assert.equal(swapped.json.status, "failed")
assert.equal(swapped.json.audioUrl, undefined)
assert.equal(calls.some((call) => call.includes("generativelanguage")), false)

calls.length = 0
const paid = await post("/api/v1/voice-studio/jobs/claim", {
  reference,
  script,
  voiceId: "sw-ke-csagent-4",
  language: "en",
})
assert.equal(paid.json.status, "ready")
assert.equal(typeof paid.json.audioUrl, "string")
assert.equal(paid.json.licenceId, reference)
assert.equal(calls.some((call) => call.includes("generativelanguage")), true)

const verify = await handleApi(new Request(`https://voice.mikaka.io/api/v1/voice-studio/verify/${reference}`))
assert.equal(verify.status, 200)
const licence = (await verify.json()) as { id: string; tier: string }
assert.equal(licence.id, reference)
assert.equal(licence.tier, "Commercial")

const forged = await handleApi(
  new Request("https://voice.mikaka.io/api/v1/voice-studio/webhooks/paystack", {
    method: "POST",
    body: JSON.stringify({ event: "charge.success" }),
  }),
)
assert.equal(forged.status, 401)

console.log("flowcheck ok")
