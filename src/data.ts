import { SAMPLE_IDS } from "./voice-samples";

// Shared product data. Prices and rules come from docs/voice-studio/PLAN.md
// on the private voice-studio branch.

export const KES_PER_USD = 129.4;
export const PAYG_USD_PER_MIN = 2;
export const PREVIEW_SECONDS = 45;
export const CHARS_PER_SECOND = 15;
export const MAX_PAYG_CHARS = 4500;

export type Language = { own: string; en?: string; code: string; premiumOnly?: boolean; writeIn?: boolean };

// Languages we speak, in their own script: only those that passed our
// translation and speech test (2026-10-29). writeIn: spoken well but not
// translated well, so the customer writes the script in the language and we
// read it as written. Kamba, Somali and Portuguese did not pass; Yoruba, Zulu
// and Luo are not supported by Gemini yet.
export const LANGUAGES: Language[] = [
  { own: "English", code: "en" },
  { own: "Kiswahili", en: "Swahili", code: "sw", premiumOnly: true },
  { own: "Gĩkũyũ", en: "Kikuyu", code: "ki", writeIn: true },
  { own: "Oluganda", en: "Luganda", code: "lg" },
  { own: "Hausa", code: "ha" },
  { own: "አማርኛ", en: "Amharic", code: "am" },
  { own: "Ikinyarwanda", en: "Kinyarwanda", code: "rw", writeIn: true },
  { own: "Igbo", code: "ig", premiumOnly: true },
  { own: "Lingála", en: "Lingala", code: "ln", writeIn: true },
  { own: "Akan", en: "Twi", code: "ak", writeIn: true },
  { own: "Chinyanja", en: "Nyanja", code: "ny" },
  { own: "ትግርኛ", en: "Tigrinya", code: "ti", premiumOnly: true },
  { own: "Sesotho", en: "Sotho", code: "st", premiumOnly: true },
  { own: "Afrikaans", code: "af" },
  { own: "Français", en: "French", code: "fr" },
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

// ---- transcription -------------------------------------------------------------
// Mirrors server/app/pricing.py and server/app/transcribe.py; the server's price
// is the one charged, from a length it measures itself.

export const TRANSCRIBE_USD_PER_MIN = 0.1;
export const MAX_TRANSCRIBE_HOURS = 3;
export const MAX_UPLOAD_MB = 500;

/** The transcription price, e.g. "$0.10 a minute". */
export const TRANSCRIBE_PRICE = `${formatUsd(TRANSCRIBE_USD_PER_MIN)} a minute`;

/** Transcription minutes included each month, per plan (Enterprise: agreed). */
export const PLAN_TRANSCRIBE_MINUTES: Record<"starter" | "creator" | "pro" | "business", number> = {
  starter: 60,
  creator: 300,
  pro: 1000,
  business: 3000,
};

export type TranscribeQuote = { seconds: number; minutes: number; usd: number; kes: number };

/** Every started minute, 1-minute minimum. */
export function transcribeQuote(seconds: number): TranscribeQuote {
  const whole = Math.ceil(Math.max(0, seconds));
  const minutes = Math.max(1, Math.ceil(whole / 60));
  const usd = Math.round(minutes * TRANSCRIBE_USD_PER_MIN * 100) / 100;
  return { seconds: whole, minutes, usd, kes: kesFor(usd) };
}

/** Upload formats: extension → the label the guide shows. The server holds the same list. */
export const TRANSCRIBE_FORMATS: { ext: string; label: string; note: string }[] = [
  { ext: "mp3", label: "MP3", note: "Best choice" },
  { ext: "m4a", label: "M4A / AAC", note: "Phone recorders" },
  { ext: "opus", label: "OPUS / OGG", note: "WhatsApp voice notes" },
  { ext: "wav", label: "WAV", note: "Large files" },
  { ext: "flac", label: "FLAC", note: "Smaller than WAV" },
  { ext: "webm", label: "WEBM", note: "Browser and Zoom" },
  { ext: "amr", label: "AMR", note: "Older call recorders" },
  { ext: "aiff", label: "AIFF", note: "Mac recordings" },
  { ext: "mp4", label: "MP4 / MOV", note: "Video, sound only" },
];
export const TRANSCRIBE_ACCEPT = ".mp3,.m4a,.aac,.wav,.flac,.ogg,.oga,.opus,.webm,.amr,.aiff,.aif,.mp4,.mov";

/** Language hints. "" detects automatically. advanced: read by the advanced model. */
export const TRANSCRIBE_LANGUAGES: { code: string; label: string; advanced?: boolean }[] = [
  { code: "", label: "Detect automatically" },
  { code: "en", label: "English" },
  { code: "sw", label: "Swahili" },
  { code: "ha", label: "Hausa" },
  { code: "zu", label: "Zulu" },
  { code: "af", label: "Afrikaans" },
  { code: "ar", label: "Arabic" },
  { code: "fr", label: "French" },
  { code: "pt", label: "Portuguese" },
  { code: "ln", label: "Lingala" },
  { code: "yo", label: "Yoruba", advanced: true },
  { code: "ig", label: "Igbo", advanced: true },
  { code: "xh", label: "Xhosa", advanced: true },
  { code: "so", label: "Somali", advanced: true },
  { code: "rw", label: "Kinyarwanda", advanced: true },
  { code: "lg", label: "Luganda", advanced: true },
  { code: "ki", label: "Kikuyu", advanced: true },
  { code: "luo", label: "Dholuo", advanced: true },
  { code: "sn", label: "Shona", advanced: true },
  { code: "am", label: "Amharic", advanced: true },
  { code: "om", label: "Oromo", advanced: true },
  { code: "ti", label: "Tigrinya", advanced: true },
  { code: "wo", label: "Wolof", advanced: true },
  { code: "tw", label: "Twi", advanced: true },
];
