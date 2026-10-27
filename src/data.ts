import { SAMPLE_IDS } from "./voice-samples";

// Shared product data. Prices and rules come from docs/voice-studio/PLAN.md
// on the private voice-studio branch.

export const KES_PER_USD = 129.4;
export const PAYG_USD_PER_MIN = 2;
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
export type Voice = {
  id: string;
  name: string;
  gender: Gender;
  style: string;
  accent: string;
  meta: string;
  sample: boolean;
};

export type Accent = { id: string; label: string };

// In the order the accent picker shows them.
export const ACCENTS: Accent[] = [
  { id: "ke", label: "Kenyan" },
  { id: "ng", label: "Nigerian" },
  { id: "za", label: "South African" },
  { id: "gh", label: "Ghanaian" },
  { id: "tz", label: "Tanzanian" },
  { id: "ug", label: "Ugandan" },
  { id: "rw", label: "Rwandan" },
  { id: "et", label: "Ethiopian" },
  { id: "zw", label: "Zimbabwean" },
  { id: "zm", label: "Zambian" },
  { id: "sn", label: "Senegalese French" },
  { id: "ci", label: "Ivorian French" },
  { id: "cd", label: "Congolese French" },
  { id: "eg", label: "Egyptian Arabic" },
  { id: "ma", label: "Moroccan Arabic" },
];

export const accentLabel = (id: string) => ACCENTS.find((a) => a.id === id)?.label ?? id;

// Voices with a recorded hello in public/voices; the rest show "sample soon".
const WITH_SAMPLE = new Set<string>(SAMPLE_IDS);

// Each name matches where its voice comes from. The server maps the id to the
// Google voice (server/app/catalog.py), so the site never sees Google's ids.
const voice = (id: string, name: string, gender: Gender, accent: string, style: string): Voice => ({
  id,
  name,
  gender,
  style,
  accent,
  meta: `${gender} · ${style} · ${accentLabel(accent)} accent`,
  sample: WITH_SAMPLE.has(id),
});

export const VOICES: Voice[] = [
  voice("wanjiru", "Wanjiru", "Female", "ke", "Warm and reassuring"),
  voice("nyokabi", "Nyokabi", "Female", "ke", "Rich, soothing narrator"),
  voice("makena", "Makena", "Female", "ke", "Bright video host"),
  voice("akinyi", "Akinyi", "Female", "ke", "Friendly storyteller"),
  voice("chebet", "Chebet", "Female", "ke", "Energetic and colourful"),
  voice("njeri", "Njeri", "Female", "ke", "Light and precise"),
  voice("atieno", "Atieno", "Female", "ke", "Crisp and eager"),
  voice("zawadi", "Zawadi", "Female", "ke", "Laid-back and kind"),
  voice("kamau", "Kamau", "Male", "ke", "Confident newsreader"),
  voice("onyango", "Onyango", "Male", "ke", "Deep, intimate radio voice"),
  voice("baraka", "Baraka", "Male", "ke", "Lively podcast host"),
  voice("kiprono", "Kiprono", "Male", "ke", "Seasoned and authoritative"),
  voice("mwangi", "Mwangi", "Male", "ke", "Commercial announcer"),
  voice("mutua", "Mutua", "Male", "ke", "Warm video host"),
  voice("jabari", "Jabari", "Male", "ke", "Young storyteller"),
  voice("kibet", "Kibet", "Male", "ke", "Fast and punchy"),
  voice("omondi", "Omondi", "Male", "ke", "Smooth and resonant"),
  voice("otieno", "Otieno", "Male", "ke", "Natural and clear"),
  voice("thandiwe", "Thandiwe", "Female", "za", "Calm documentary narrator"),
  voice("lerato", "Lerato", "Female", "za", "Bright advert voice"),
  voice("naledi", "Naledi", "Female", "za", "Friendly video host"),
  voice("thabo", "Thabo", "Male", "za", "Documentary narrator"),
  voice("sipho", "Sipho", "Male", "za", "Confident advert voice"),
  voice("bongani", "Bongani", "Male", "za", "Clear news voice"),
  voice("nour", "Nour", "Female", "eg", "Radio host"),
  voice("mariam", "Mariam", "Female", "eg", "Light, precise storyteller"),
  voice("omar", "Omar", "Male", "eg", "Deep, unhurried narrator"),
  voice("karim", "Karim", "Male", "eg", "Resonant advert voice"),
  voice("funmi", "Funmi", "Female", "ng", "Warm radio presenter"),
  voice("tunde", "Tunde", "Male", "ng", "Upbeat advert voice"),
  voice("emeka", "Emeka", "Male", "ng", "Calm, authoritative narrator"),
  voice("chiamaka", "Chiamaka", "Female", "ng", "Bright and cheerful"),
  voice("aisha", "Aisha", "Female", "ng", "Gentle and reassuring"),
  voice("musa", "Musa", "Male", "ng", "Polished national broadcaster"),
  voice("akosua", "Akosua", "Female", "gh", "Bright and smiling"),
  voice("kwame", "Kwame", "Male", "gh", "Steady radio newsreader"),
  voice("nakato", "Nakato", "Female", "ug", "Warm and professional"),
  voice("mukasa", "Mukasa", "Male", "ug", "Energetic presenter"),
  voice("rehema", "Rehema", "Female", "tz", "Lively radio advert voice"),
  voice("juma", "Juma", "Male", "tz", "Deep, dignified narrator"),
  voice("selam", "Selam", "Female", "et", "Bright advert presenter"),
  voice("abebe", "Abebe", "Male", "et", "Calm documentary narrator"),
  voice("uwase", "Uwase", "Female", "rw", "Gentle, soothing narrator"),
  voice("mugisha", "Mugisha", "Male", "rw", "Lively advert voice"),
  voice("rufaro", "Rufaro", "Female", "zw", "Cheerful and engaging"),
  voice("tendai", "Tendai", "Male", "zw", "Rich, seasoned broadcaster"),
  voice("chileshe", "Chileshe", "Female", "zm", "Calm, caring storyteller"),
  voice("mwila", "Mwila", "Male", "zm", "Confident and lively"),
  voice("awa", "Awa", "Female", "sn", "Bright TV presenter"),
  voice("moussa", "Moussa", "Male", "sn", "Measured radio voice"),
  voice("aya", "Aya", "Female", "ci", "Gentle and professional"),
  voice("yao", "Yao", "Male", "ci", "Bright and punchy"),
  voice("bijou", "Bijou", "Female", "cd", "Lively and cheerful"),
  voice("ilunga", "Ilunga", "Male", "cd", "Deep, authoritative narrator"),
  voice("salma", "Salma", "Female", "ma", "Friendly advert presenter"),
  voice("youssef", "Youssef", "Male", "ma", "Warm, steady narrator"),
];

/** Accents that have at least one voice, in picker order. */
export const LIVE_ACCENTS: Accent[] = ACCENTS.filter((a) => VOICES.some((v) => v.accent === a.id));

export const DEFAULT_VOICE = "wanjiru";

/** A five-second hello in the voice, served from public/voices. */
export const voiceSample = (id: string) => `/voices/${id}.mp3?v=2`;

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
  const kes = kesFor(usd);
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

/** Prices are shown in US dollars: $2, $2.50, $1,200. Paystack still charges the KES figure. */
export function formatUsd(usd: number): string {
  const whole = Math.abs(usd - Math.round(usd)) < 0.005;
  const n = whole
    ? Math.round(usd).toLocaleString("en-US")
    : usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${n}`;
}

/** What a dollar figure costs in shillings: the checkout's own rounding, up to the next KES 5. */
export function kesFor(usd: number): number {
  return Math.ceil((usd * KES_PER_USD) / 5) * 5;
}

/** The pay-as-you-go price, e.g. "$2 a minute". */
export const PAYG_PRICE = `${formatUsd(PAYG_USD_PER_MIN)} a minute`;
