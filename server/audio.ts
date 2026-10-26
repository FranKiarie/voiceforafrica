import { Mp3Encoder } from "@breezystack/lamejs"

export type Pcm = { samples: Buffer; sampleRate: number }

const DATA_URL_BYTES = 2_600_000

export function parseWav(buf: Buffer): Pcm {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Gemini did not return a WAV file")
  }
  let offset = 12
  let channels = 1
  let sampleRate = 24000
  let bits = 16
  let pcm: Buffer | null = null
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const start = offset + 8
    if (start + size > buf.length) break
    if (id === "fmt ") {
      channels = buf.readUInt16LE(start + 2)
      sampleRate = buf.readUInt32LE(start + 4)
      bits = buf.readUInt16LE(start + 14)
    } else if (id === "data") {
      pcm = buf.subarray(start, start + size)
      break
    }
    offset = start + size + (size % 2)
  }
  if (!pcm || bits !== 16 || channels < 1 || sampleRate < 8000) throw new Error("Unsupported WAV from Gemini")
  return { samples: toMono(Buffer.from(pcm), channels), sampleRate }
}

function toMono(pcm: Buffer, channels: number): Buffer {
  if (channels === 1) return pcm.subarray(0, pcm.length - (pcm.length % 2))
  const frames = Math.floor(pcm.length / 2 / channels)
  const out = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) sum += pcm.readInt16LE((i * channels + c) * 2)
    const mixed = Math.max(-32768, Math.min(32767, Math.round(sum / channels)))
    out.writeInt16LE(mixed, i * 2)
  }
  return out
}

export function wavDuration(pcm: Pcm): number {
  return pcm.samples.length / 2 / pcm.sampleRate
}

/** Hard cap so a preview cannot run past the free window. Fades the last 20 ms. */
export function trimPcm(pcm: Pcm, maxSeconds: number): Pcm {
  const maxFrames = Math.floor(maxSeconds * pcm.sampleRate)
  const frames = pcm.samples.length / 2
  if (frames <= maxFrames) return pcm
  const cut = Buffer.from(pcm.samples.subarray(0, maxFrames * 2))
  const fade = Math.min(Math.floor(pcm.sampleRate * 0.02), maxFrames)
  for (let i = 0; i < fade; i++) {
    const at = (maxFrames - fade + i) * 2
    const gain = 1 - i / fade
    cut.writeInt16LE(Math.round(cut.readInt16LE(at) * gain), at)
  }
  return { samples: cut, sampleRate: pcm.sampleRate }
}

export function wrapWav(pcm: Pcm): Buffer {
  const data = pcm.samples
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(pcm.sampleRate, 24)
  header.writeUInt32LE(pcm.sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

export function encodeMp3(pcm: Pcm, kbps: number): Buffer {
  const copy = new Int16Array(pcm.samples.buffer, pcm.samples.byteOffset, pcm.samples.length / 2)
  const samples = new Int16Array(copy)
  const encoder = new Mp3Encoder(1, pcm.sampleRate, kbps)
  const chunks: Uint8Array[] = []
  const block = 1152
  for (let i = 0; i < samples.length; i += block) {
    const buf = encoder.encodeBuffer(samples.subarray(i, Math.min(i + block, samples.length)))
    if (buf.length) chunks.push(buf)
  }
  const end = encoder.flush()
  if (end.length) chunks.push(end)
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)))
}

export function fitsInline(bytes: Buffer): boolean {
  return bytes.length <= DATA_URL_BYTES
}

/** Smallest listenable file that still fits a serverless JSON response. */
export function compressToFit(pcm: Pcm): { bytes: Buffer; mime: string } | null {
  const wav = wrapWav(pcm)
  if (fitsInline(wav)) return { bytes: wav, mime: "audio/wav" }
  for (const kbps of [96, 64, 48, 32]) {
    const mp3 = encodeMp3(pcm, kbps)
    if (fitsInline(mp3)) return { bytes: mp3, mime: "audio/mpeg" }
  }
  return null
}

export function dataUrl(bytes: Buffer, mime: string): string {
  return `data:${mime};base64,${bytes.toString("base64")}`
}

export function splitScript(script: string, max = 1200): string[] {
  if (script.length <= max) return [script]
  const parts: string[] = []
  let rest = script
  while (rest.length > max) {
    const window = rest.slice(0, max)
    let cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "))
    if (cut < 400) cut = max
    else cut += 1
    const piece = rest.slice(0, cut).trim()
    if (piece) parts.push(piece)
    rest = rest.slice(cut).trim()
  }
  if (rest) parts.push(rest)
  return parts
}
