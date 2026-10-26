import { compressToFit, dataUrl, fitsInline, type Pcm } from "./audio"
import { masterWav, wavDuration } from "./gemini"

export type StoredAudio = { url: string; mime: string; seconds: number }

const memory = new Map<string, StoredAudio>()

function safe(reference: string): string {
  return reference.replace(/[^a-zA-Z0-9_-]/g, "")
}

export function remembered(reference: string): StoredAudio | null {
  return memory.get(reference) ?? null
}

async function blobToken(): Promise<string | null> {
  return process.env.BLOB_READ_WRITE_TOKEN || null
}

export async function recallClip(reference: string): Promise<StoredAudio | null> {
  const cached = remembered(reference)
  if (cached) return cached
  const token = await blobToken()
  if (!token) return null
  try {
    const { head } = await import("@vercel/blob")
    const meta = await head(`clips/${safe(reference)}.json`, { token })
    const res = await fetch(meta.url)
    if (!res.ok) return null
    const body = (await res.json()) as Partial<StoredAudio>
    if (typeof body.url !== "string" || typeof body.mime !== "string" || typeof body.seconds !== "number") return null
    const stored = { url: body.url, mime: body.mime, seconds: body.seconds }
    memory.set(reference, stored)
    return stored
  } catch {
    return null
  }
}

async function putBlob(path: string, bytes: Buffer, contentType: string): Promise<string | null> {
  const token = await blobToken()
  if (!token) return null
  const { put } = await import("@vercel/blob")
  const blob = await put(path, bytes, {
    access: "public",
    token,
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  })
  return blob.url
}

/**
 * Prefer a public WAV (SynthID stays intact). Without file storage, fall back
 * to a data URL, compressing to MP3 only when the WAV will not fit the response.
 */
export async function publishClip(reference: string, pcm: Pcm): Promise<StoredAudio> {
  const cached = await recallClip(reference)
  if (cached) return cached
  const seconds = Math.max(1, Math.round(wavDuration(pcm)))
  const wav = masterWav(pcm)
  const wavUrl = await putBlob(`clips/${safe(reference)}.wav`, wav, "audio/wav")
  let stored: StoredAudio
  if (wavUrl) {
    stored = { url: wavUrl, mime: "audio/wav", seconds }
    await putBlob(
      `clips/${safe(reference)}.json`,
      Buffer.from(JSON.stringify(stored)),
      "application/json",
    )
  } else {
    const inline = wav.length && fitsInline(wav) ? { bytes: wav, mime: "audio/wav" } : compressToFit(pcm)
    if (!inline) throw new Error("Audio is too large to deliver. Add BLOB_READ_WRITE_TOKEN on Vercel.")
    stored = { url: dataUrl(inline.bytes, inline.mime), mime: inline.mime, seconds }
  }
  memory.set(reference, stored)
  return stored
}
