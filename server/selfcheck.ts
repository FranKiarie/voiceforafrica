import assert from "node:assert/strict"
import { encodeMp3, parseWav, splitScript, trimPcm, wavDuration, wrapWav } from "./audio"
import { assessPayment, newLicenceId, sha256, signaturesMatch, type Tx } from "./paystack"
import { quoteFor } from "../src/pricing"

const oneMinute = "a".repeat(15 * 60)
assert.equal(quoteFor("").kes, 0)
assert.equal(quoteFor("Hello from Nairobi.").kes, 195)
assert.equal(quoteFor(oneMinute).billedMinutes, 1)
assert.equal(quoteFor(oneMinute).kes, 195)
assert.equal(quoteFor(`${oneMinute} more words here`).billedMinutes, 2)
assert.equal(quoteFor(`${oneMinute} more words here`).kes, 390)

const id = newLicenceId(new Date("2026-10-27T00:00:00Z"))
assert.match(id, /^VS-2026-[A-Z0-9]{6}$/)

const hash = sha256("Karibu")
const tx = (patch: Partial<Tx> = {}): Tx => ({
  status: "success",
  amount: 19500,
  currency: "KES",
  paidAt: "2026-10-27T08:00:00.000Z",
  metadata: {
    product: "mikaka-voice",
    script_sha256: hash,
    voice_id: "sw-ke-csagent-4",
    language: "en",
    amount_kes: "195",
  },
  ...patch,
})
assert.equal(assessPayment(tx(), { scriptHash: hash, voiceId: "sw-ke-csagent-4", language: "en" }), "ok")
assert.equal(assessPayment(tx({ status: "ongoing" }), { scriptHash: hash, voiceId: "sw-ke-csagent-4", language: "en" }), "pending")
assert.equal(assessPayment(tx({ status: "abandoned" }), { scriptHash: hash, voiceId: "sw-ke-csagent-4", language: "en" }), "failed")
assert.equal(assessPayment(tx({ amount: 100 }), { scriptHash: hash, voiceId: "sw-ke-csagent-4", language: "en" }), "mismatch")
assert.equal(assessPayment(tx(), { scriptHash: sha256("other"), voiceId: "sw-ke-csagent-4", language: "en" }), "mismatch")
assert.equal(signaturesMatch("{}", "nope", "secret"), false)
const { createHmac } = await import("node:crypto")
const good = createHmac("sha512", "secret").update("{}", "utf8").digest("hex")
assert.equal(signaturesMatch("{}", good, "secret"), true)

const pcm = Buffer.alloc(24000 * 2)
for (let i = 0; i < 24000; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 8) * 8000), i * 2)
const wav = wrapWav({ samples: pcm, sampleRate: 24000 })
const parsed = parseWav(wav)
assert.equal(Math.round(wavDuration(parsed)), 1)
const trimmed = trimPcm(parsed, 0.5)
assert.ok(wavDuration(trimmed) <= 0.5)
const mp3 = encodeMp3(trimmed, 64)
assert.ok(mp3.length > 100)
assert.equal(mp3[0], 0xff)
assert.deepEqual(splitScript("short"), ["short"])
const long = `${"word ".repeat(400)}. ${"tail ".repeat(400)}`
const parts = splitScript(long, 1200)
assert.ok(parts.length >= 2)
assert.ok(parts.every((part) => part.length <= 1200))

console.log("selfcheck ok")
