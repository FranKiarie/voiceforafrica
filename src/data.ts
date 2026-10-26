// Shared product data. The shilling price lives in pricing.ts — one number.

export const KES_PER_USD = 129.4;

export {
  CHARS_PER_SECOND,
  KES_PER_MINUTE,
  MAX_PAYG_CHARS,
  MIN_SCRIPT_CHARS,
  PREVIEW_SECONDS,
  normalizeScript,
  previewSource,
  quoteFor,
} from "./pricing";
export type { Quote } from "./pricing";

export type Language = { own: string; en?: string; code: string; premiumOnly?: boolean };

// Languages Gemini TTS speaks today, in their own script. Yoruba, Zulu and
// Luo are not supported yet.
export const LANGUAGES: Language[] = [
  { own: "English", code: "en" },
  { own: "Kiswahili", en: "Swahili", code: "sw", premiumOnly: true },
  { own: "Gĩkũyũ", en: "Kikuyu", code: "ki" },
  { own: "Kĩkamba", en: "Kamba", code: "kam" },
  { own: "Oluganda", en: "Luganda", code: "lg" },
  { own: "Hausa", code: "ha" },
  { own: "አማርኛ", en: "Amharic", code: "am" },
  { own: "Ikinyarwanda", en: "Kinyarwanda", code: "rw" },
  { own: "Igbo", code: "ig", premiumOnly: true },
  { own: "Soomaali", en: "Somali", code: "so", premiumOnly: true },
  { own: "Lingála", en: "Lingala", code: "ln" },
  { own: "Akan", en: "Twi", code: "ak" },
  { own: "Chinyanja", en: "Nyanja", code: "ny" },
  { own: "ትግርኛ", en: "Tigrinya", code: "ti", premiumOnly: true },
  { own: "Sesotho", en: "Sotho", code: "st", premiumOnly: true },
  { own: "Afrikaans", code: "af" },
  { own: "Français", en: "French", code: "fr" },
  { own: "Português", en: "Portuguese", code: "pt" },
  { own: "العربية", en: "Arabic", code: "ar" },
];

export type Voice = {
  id: string;
  name: string;
  country: string;
  meta: string;
  /** Gemini 3.8 extended voice. Kenyan Kiswahili + English. */
  geminiVoice: string;
  style: string;
};

// Gemini 3.8 Flash voices for Swahili (Kenya). Other countries come later.
export const VOICES: Voice[] = [
  { id: "sw-ke-csagent-4", geminiVoice: "Csagent4", style: "warm, clear, and professional", name: "Call Centre Agent 4", country: "Kenya", meta: "Kenya · Female · Kiswahili + English" },
  { id: "sw-ke-advisor-1", geminiVoice: "Advisor1", style: "calm and reassuring", name: "Advisor 1", country: "Kenya", meta: "Kenya · Kiswahili + English" },
  { id: "sw-ke-tutor-2", geminiVoice: "Tutor2", style: "bright and patient", name: "Tutor 2", country: "Kenya", meta: "Kenya · Kiswahili + English" },
  { id: "sw-ke-concierge-3", geminiVoice: "Concierge3", style: "friendly and welcoming", name: "Concierge 3", country: "Kenya", meta: "Kenya · Kiswahili + English" },
  { id: "sw-ke-assistant-5", geminiVoice: "Assistant5", style: "soft and helpful", name: "Assistant 5", country: "Kenya", meta: "Kenya · Kiswahili + English" },
  { id: "sw-ke-training-6", geminiVoice: "Training6", style: "clear and steady", name: "Training 6", country: "Kenya", meta: "Kenya · Kiswahili + English" },
];

export const COMING_SOON: { country: string; pattern: PatternId }[] = [
  { country: "Nigeria", pattern: "adire" },
  { country: "Ghana", pattern: "kente" },
  { country: "South Africa", pattern: "ndebele" },
  { country: "Tanzania", pattern: "kitenge" },
  { country: "Uganda", pattern: "bark" },
];

export type PatternId = "band" | "beads" | "adire" | "kente" | "ndebele" | "kitenge" | "bark" | "mud";

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} s`;
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatKes(kes: number): string {
  return `KES ${kes.toLocaleString("en-KE")}`;
}
