import { PREVIEW_SECONDS } from "../src/pricing"
import type { Voice } from "../src/data"
import { encodeMp3, parseWav, trimPcm, wavDuration, wrapWav, type Pcm } from "./audio"

const MODEL = () => process.env.GEMINI_TTS_MODEL || "gemini-3.8-flash-tts"
const FALLBACK_VOICE = "Kore"

export class ScriptRejected extends Error {
  constructor() {
    super("script rejected")
  }
}

type GeminiPart = { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string }; text?: string }
type GeminiBody = {
  candidates?: Array<{ finishReason?: string; content?: { parts?: GeminiPart[] } }>
  promptFeedback?: { blockReason?: string }
  error?: { message?: string }
}

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY
  if (!key) throw new Error("GEMINI_API_KEY is not set")
  return key
}

async function synthesizeOne(text: string, voiceName: string, style: string): Promise<Pcm> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL()}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey() },
    signal: AbortSignal.timeout(55_000),
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text, speech_metadata: { style } }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        responseFormat: { audio: { mimeType: "AUDIO_WAV", sampleRate: 24000 } },
        speechConfig: { voiceConfig: { voice: voiceName } },
      },
    }),
  })
  const body = (await res.json().catch(() => ({}))) as GeminiBody
  if (!res.ok) {
    const message = body.error?.message ?? res.statusText
    console.error("Gemini TTS failed", res.status, voiceName, message.slice(0, 240))
    if (res.status === 400 && /voice|not found|invalid/i.test(message)) {
      throw new VoiceRejected(message)
    }
    throw new Error("Gemini TTS failed")
  }
  if (body.promptFeedback?.blockReason || body.candidates?.[0]?.finishReason === "SAFETY") {
    throw new ScriptRejected()
  }
  const part = body.candidates?.[0]?.content?.parts?.find((item) => item.inlineData?.data || item.inline_data?.data)
  const b64 = part?.inlineData?.data ?? part?.inline_data?.data
  if (!b64) {
    console.error("Gemini TTS returned no audio", body.candidates?.[0]?.finishReason ?? "none")
    throw new Error("Gemini TTS returned no audio")
  }
  const bytes = Buffer.from(b64, "base64")
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF") return parseWav(bytes)
  return { samples: bytes.subarray(0, bytes.length - (bytes.length % 2)), sampleRate: 24000 }
}

class VoiceRejected extends Error {}

async function synthesizeVoice(text: string, voice: Voice): Promise<Pcm> {
  try {
    return await synthesizeOne(text, voice.geminiVoice, voice.style)
  } catch (error) {
    if (!(error instanceof VoiceRejected)) throw error
    console.error("Falling back from", voice.geminiVoice, "to", FALLBACK_VOICE)
    return synthesizeOne(text, FALLBACK_VOICE, `${voice.style}, Kenyan accent`)
  }
}

function concat(parts: Pcm[]): Pcm {
  const sampleRate = parts[0]?.sampleRate ?? 24000
  if (parts.some((part) => part.sampleRate !== sampleRate)) throw new Error("Sample rates did not match")
  return { samples: Buffer.concat(parts.map((part) => part.samples)), sampleRate }
}

export async function speak(voice: Voice, parts: string[]): Promise<Pcm> {
  const spoken: Pcm[] = []
  for (const part of parts) {
    spoken.push(await synthesizeVoice(part, voice))
  }
  if (!spoken.length) throw new Error("Nothing to speak")
  return concat(spoken)
}

export async function speakPreview(text: string, voice: Voice): Promise<{ bytes: Buffer; mime: string; seconds: number }> {
  const pcm = trimPcm(await synthesizeVoice(text, voice), PREVIEW_SECONDS)
  const seconds = Math.max(1, Math.round(wavDuration(pcm)))
  const mp3 = encodeMp3(pcm, 96)
  return { bytes: mp3, mime: "audio/mpeg", seconds: Math.min(seconds, PREVIEW_SECONDS) }
}

export function masterWav(pcm: Pcm): Buffer {
  return wrapWav(pcm)
}

export { wavDuration }
