// Launch price. Every page and the Paystack charge read this number.
// Cost to us is about KES 2 a minute (Gemini 3.8 Flash TTS, late 2026),
// so KES 195 leaves room for Paystack fees and a real margin.
// One minute minimum. Longer scripts round up to the next minute.

export const KES_PER_MINUTE = 195
export const PREVIEW_SECONDS = 45
export const CHARS_PER_SECOND = 15
export const MAX_PAYG_CHARS = 4500
export const MIN_SCRIPT_CHARS = 20
/** Characters sent for a preview. Audio is hard-cut at PREVIEW_SECONDS. */
export const PREVIEW_CHAR_BUDGET = 900

export type Quote = {
  chars: number
  projectedSeconds: number
  billedSeconds: number
  billedMinutes: number
  kes: number
}

export function normalizeScript(script: string): string {
  return script.normalize("NFC").replace(/\r\n/g, "\n").trim()
}

/** Projected speech, then the shillings we actually charge. */
export function quoteFor(script: string): Quote {
  const chars = normalizeScript(script).length
  if (chars === 0) return { chars: 0, projectedSeconds: 0, billedSeconds: 0, billedMinutes: 0, kes: 0 }
  const projectedSeconds = Math.max(1, Math.round(chars / CHARS_PER_SECOND))
  const billedMinutes = Math.max(1, Math.ceil(projectedSeconds / 60))
  return {
    chars,
    projectedSeconds,
    billedSeconds: billedMinutes * 60,
    billedMinutes,
    kes: billedMinutes * KES_PER_MINUTE,
  }
}

/** The words we send for the free preview. The whole script when it is short. */
export function previewSource(script: string): string {
  const clean = normalizeScript(script)
  if (clean.length <= PREVIEW_CHAR_BUDGET) return clean
  const slice = clean.slice(0, PREVIEW_CHAR_BUDGET)
  const boundary = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "), slice.lastIndexOf("\n"))
  if (boundary >= 80) return slice.slice(0, boundary + 1).trim()
  return slice.trim()
}
