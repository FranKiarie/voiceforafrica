// Shared product data. Prices and rules come from docs/voice-studio/PLAN.md
// on the private voice-studio branch.

export const KES_PER_USD = 129.4;
export const PAYG_USD_PER_MIN = 1.5;
export const PREVIEW_SECONDS = 45;
export const CHARS_PER_SECOND = 15;
export const MAX_PAYG_CHARS = 4500;

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

export type Gender = "Female" | "Male";
export type Voice = { id: string; name: string; gender: Gender; style: string; meta: string };

// Google library voices with a Kenyan accent, shown under African first names.
// The server maps each id to the library voice (server/app/catalog.py).
const voice = (id: string, name: string, gender: Gender, style: string): Voice => ({
  id,
  name,
  gender,
  style,
  meta: `${gender} · ${style} · Kenyan accent`,
});

export const VOICES: Voice[] = [
  voice("amara", "Amara", "Female", "Warm and reassuring"),
  voice("thandiwe", "Thandiwe", "Female", "Rich, soothing narrator"),
  voice("naledi", "Naledi", "Female", "Bright video host"),
  voice("akinyi", "Akinyi", "Female", "Friendly storyteller"),
  voice("adwoa", "Adwoa", "Female", "Lively podcast host"),
  voice("folake", "Folake", "Female", "Energetic and colourful"),
  voice("selam", "Selam", "Female", "Light and precise"),
  voice("ngozi", "Ngozi", "Female", "Crisp and eager"),
  voice("zawadi", "Zawadi", "Female", "Laid-back and kind"),
  voice("kwame", "Kwame", "Male", "Confident newsreader"),
  voice("thabo", "Thabo", "Male", "Deep, intimate radio voice"),
  voice("abebe", "Abebe", "Male", "Seasoned and authoritative"),
  voice("sekou", "Sekou", "Male", "Commercial announcer"),
  voice("bongani", "Bongani", "Male", "Warm video host"),
  voice("jabari", "Jabari", "Male", "Young storyteller"),
  voice("chidi", "Chidi", "Male", "Fast and punchy"),
  voice("tendai", "Tendai", "Male", "Smooth and resonant"),
  voice("otieno", "Otieno", "Male", "Natural and clear"),
];

export const DEFAULT_VOICE = "amara";

/** A five-second hello in the voice, served from public/voices. */
export const voiceSample = (id: string) => `/voices/${id}.mp3`;

export type Purpose = { id: string; label: string };

// What the voice-over is for. The server turns each into a short delivery note.
export const PURPOSES: Purpose[] = [
  { id: "general", label: "General voice-over" },
  { id: "radio-ad", label: "Radio ad" },
  { id: "commercial", label: "TV or online ad" },
  { id: "documentary", label: "Documentary" },
  { id: "explainer", label: "Corporate or explainer video" },
  { id: "training", label: "Training or e-learning" },
  { id: "story", label: "Audiobook or story" },
  { id: "news", label: "News read" },
  { id: "podcast", label: "Podcast intro or outro" },
  { id: "phone", label: "Phone menu or on-hold message" },
  { id: "social", label: "Social media video" },
  { id: "announcement", label: "Event or public announcement" },
];

export const DEFAULT_PURPOSE = "general";

export const COMING_SOON: { country: string; pattern: PatternId }[] = [
  { country: "Nigeria", pattern: "adire" },
  { country: "Ghana", pattern: "kente" },
  { country: "South Africa", pattern: "ndebele" },
  { country: "Tanzania", pattern: "kitenge" },
  { country: "Uganda", pattern: "bark" },
];

export type PatternId = "band" | "beads" | "adire" | "kente" | "ndebele" | "kitenge" | "bark" | "mud";

export type Quote = {
  chars: number;
  projectedSeconds: number;
  billedSeconds: number;
  usd: number;
  kes: number;
};

// Projected length = characters ÷ speaking rate × 1.1, rounded up to the next
// 30 seconds, with a 1-minute minimum. The price shown is the price paid.
export function quoteFor(script: string): Quote {
  const chars = script.trim().length;
  const projectedSeconds = Math.round(chars / CHARS_PER_SECOND);
  const padded = (chars / CHARS_PER_SECOND) * 1.1;
  const billedSeconds = Math.max(60, Math.ceil(padded / 30) * 30);
  const usd = Math.round((billedSeconds / 60) * PAYG_USD_PER_MIN * 100) / 100;
  const kes = Math.ceil((usd * KES_PER_USD) / 5) * 5;
  return { chars, projectedSeconds, billedSeconds, usd, kes };
}

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
