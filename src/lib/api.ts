// The one place the frontend talks to the voice backend.
//
// Live mode: VITE_API_BASE is set (the Fly app, e.g. https://api.voice.mikaka.io).
// Demo mode: no base URL, so every call is answered in the browser. The demo
// keeps licences and clips in localStorage and never moves money or makes audio.

import { KES_PER_USD, MAX_TRANSCRIBE_HOURS, MAX_UPLOAD_MB, formatDuration, quoteFor, transcribeQuote, VOICES } from "../data";
import { accessToken, supabase } from "./supabase";

const BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");
export const API_MODE: "live" | "demo" = BASE ? "live" : "demo";

export type Preview = { previewId: string; seconds: number; audioUrl?: string };
export type PaygCheckout = { jobId: string; amountKes: number; amountUsd?: number; accessCode?: string };
export type JobStatus = "paying" | "generating" | "ready" | "failed";
/** One downloadable audio version of a paid clip. `needs` names the plan that unlocks a locked one. */
export type AudioVersion = { id: string; label: string; allowed: boolean; needs?: string };
export type Job = {
  jobId: string;
  status: JobStatus;
  seconds?: number;
  audioUrl?: string;
  licenceId?: string;
  versions?: AudioVersion[];
};
export type Licence = { id: string; tier: string; voice: string; length: string; issued: string; paidKes?: number };
export type Clip = {
  id: string;
  licenceId: string;
  voice: string;
  length: string;
  seconds?: number;
  createdAt: string;
  tier: string;
  audioUrl?: string;
  versions?: AudioVersion[];
};
export type Plan ="starter" | "creator" | "pro" | "business";
export type Billing = "monthly" | "yearly";
export type PlanCheckout = { checkoutId: string; amountKes: number; amountUsd: number; accessCode?: string };

export type PlanStatus = "pending" | "active" | "expired" | "failed";
export type PlanConfirmation = { checkoutId: string; status: PlanStatus; plan: Plan; billing: Billing; periodEnd?: string };
export type Session = { accessToken: string; expiresAt: number; email?: string };
export type Account = {
  email: string;
  plan: { plan: Plan; billing: Billing; periodEnd: string } | null;
  previewsLeft: number;
  previewsPerDay: number;
  spentKes: number;
  spentUsd?: number;
};

// ---- session --------------------------------------------------------------
// Supabase Auth owns the session: supabase-js reads the magic-link / OAuth hash
// itself (detectSessionInUrl), stores it and refreshes the token. These helpers
// are thin wrappers kept for older importers.

/** The current session, or null when signed out. */
export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!s) return null;
  return {
    accessToken: s.access_token,
    expiresAt: (s.expires_at ?? Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600)) * 1000,
    email: s.user?.email ?? undefined,
  };
}

export async function isSignedIn(): Promise<boolean> {
  return (await accessToken()) !== null;
}

export async function signOut(): Promise<void> {
  try {
    await supabase.auth.signOut();
  } catch {
    // Network down: supabase-js still clears the local session.
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  const token = await accessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api/v1/voice-studio${path}`, {
    method,
    credentials: "include",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).detail ?? msg;
    } catch {
      // keep statusText
    }
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

// ---- demo store -----------------------------------------------------------

const LICENCES_KEY = "mv.licences";
const JOBS_KEY = "mv.jobs";

function readList<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}

function writeList<T>(key: string, list: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Private mode: the demo simply forgets.
  }
}

function newLicenceId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `VS-${new Date().getFullYear()}-${s}`;
}

type DemoJob = Job & { voice: string; paidKes: number; paidUsd?: number; createdAt: string };

// What the server lists for a pay-as-you-go buyer: MP3 only, the rest locked by plan.
const DEMO_VERSIONS: AudioVersion[] = [
  { id: "mp3", label: "MP3 · 96 kbps", allowed: true },
  { id: "wav", label: "WAV · 24 kHz 16-bit", allowed: false, needs: "Starter" },
  { id: "m4a", label: "M4A (AAC) · 128 kbps", allowed: false, needs: "Starter" },
  { id: "ogg", label: "OGG Opus · 64 kbps", allowed: false, needs: "Starter" },
  { id: "ivr-wav", label: "Phone system WAV · 8 kHz 16-bit", allowed: false, needs: "Creator" },
  { id: "ivr-ulaw", label: "Phone system μ-law · 8 kHz (G.711)", allowed: false, needs: "Creator" },
  { id: "ivr-alaw", label: "Phone system A-law · 8 kHz (G.711)", allowed: false, needs: "Creator" },
];

const demoVersions = () => DEMO_VERSIONS.map((v) => ({ ...v }));

/** A plain download link for one version of a ready clip. Demo: null, as there is no audio. */
export function jobDownloadUrl(jobId: string, versionId: string): string | null {
  if (API_MODE === "demo") return null;
  return `${BASE}/api/v1/voice-studio/jobs/${encodeURIComponent(jobId)}/download?version=${encodeURIComponent(versionId)}`;
}

const voiceName = (id: string) => VOICES.find((v) => v.id === id)?.name ?? id;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- endpoints ------------------------------------------------------------

/** Free preview: at least 45 s of the script (the whole clip if shorter). */
export async function createPreview(input: {
  script: string;
  voiceId: string;
  language: string;
  email: string;
  purpose: string;
}): Promise<Preview> {
  if (API_MODE === "live") return call("POST", "/previews", input);
  const q = quoteFor(input.script);
  await wait(600);
  return { previewId: `demo-${Date.now()}`, seconds: q.projectedSeconds <= 45 ? Math.max(5, q.projectedSeconds) : 47 };
}

/** Starts a pay-as-you-go job. Live: the server prices it and returns a Paystack access code. */
export async function createPaygCheckout(input: {
  previewId?: string;
  script: string;
  voiceId: string;
  language: string;
  email: string;
  purpose: string;
}): Promise<PaygCheckout> {
  if (API_MODE === "live") return call("POST", "/payg/checkout", input);
  const q = quoteFor(input.script);
  const job: DemoJob = {
    jobId: `demo-${Date.now()}`,
    status: "paying",
    seconds: q.projectedSeconds,
    voice: voiceName(input.voiceId),
    paidKes: q.kes,
    paidUsd: q.usd,
    createdAt: new Date().toISOString(),
  };
  writeList(JOBS_KEY, [...readList<DemoJob>(JOBS_KEY), job]);
  return { jobId: job.jobId, amountKes: q.kes, amountUsd: q.usd };
}

/** Demo only: marks a job paid, as the Paystack webhook would on the server. */
export function confirmDemoPayment(jobId: string) {
  const jobs = readList<DemoJob>(JOBS_KEY).map((j) => (j.jobId === jobId && j.status === "paying" ? { ...j, status: "generating" as const } : j));
  writeList(JOBS_KEY, jobs);
}

/** Poll after payment until status is "ready" (or "failed"). */
export async function getJob(jobId: string): Promise<Job> {
  if (API_MODE === "live") return call("GET", `/jobs/${encodeURIComponent(jobId)}`);
  const jobs = readList<DemoJob>(JOBS_KEY);
  const job = jobs.find((j) => j.jobId === jobId);
  if (!job) throw new ApiError(404, "Job not found");
  if (job.status === "generating") {
    await wait(1500);
    const licenceId = newLicenceId();
    const done: DemoJob = { ...job, status: "ready", licenceId };
    writeList(JOBS_KEY, jobs.map((j) => (j.jobId === jobId ? done : j)));
    const licence: Licence = {
      id: licenceId,
      tier: "Commercial",
      voice: job.voice,
      length: formatDuration(job.seconds ?? 0),
      issued: new Date().toISOString().slice(0, 10),
      paidKes: job.paidKes,
    };
    writeList(LICENCES_KEY, [...readList<Licence>(LICENCES_KEY), licence]);
    return { ...done, versions: demoVersions() };
  }
  return job.status === "ready" ? { ...job, versions: demoVersions() } : job;
}

/** Public licence check. Returns null when the ID was never issued. */
export async function verifyLicence(id: string): Promise<Licence | null> {
  if (API_MODE === "live") {
    try {
      return await call("GET", `/verify/${encodeURIComponent(id)}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }
  await wait(300);
  return readList<Licence>(LICENCES_KEY).find((l) => l.id.toUpperCase() === id.toUpperCase()) ?? null;
}

/** Emails a sign-in link. */
export async function requestMagicLink(email: string): Promise<void> {
  if (API_MODE === "live") return call("POST", "/auth/magic-link", { email });
  await wait(700);
}

/** Clips for the signed-in account (demo: everything made in this browser). */
export async function listClips(): Promise<Clip[]> {
  if (API_MODE === "live") return call("GET", "/clips");
  return readList<DemoJob>(JOBS_KEY)
    .filter((j) => j.status === "ready" && j.licenceId)
    .map((j) => ({
      id: j.jobId,
      licenceId: j.licenceId!,
      voice: j.voice,
      length: formatDuration(j.seconds ?? 0),
      seconds: j.seconds ?? 0,
      createdAt: j.createdAt,
      tier: "Commercial",
      versions: demoVersions(),
    }))
    .reverse();
}

/** The signed-in account's plan, free previews left today and total spend. */
export async function getAccount(): Promise<Account> {
  if (API_MODE === "live") return call("GET", "/account");
  await wait(200);
  const paid = readList<DemoJob>(JOBS_KEY).filter((j) => j.status === "ready");
  const spentKes = paid.reduce((sum, j) => sum + (j.paidKes ?? 0), 0);
  const spentUsd = Math.round(paid.reduce((sum, j) => sum + (j.paidUsd ?? (j.paidKes ?? 0) / KES_PER_USD), 0) * 100) / 100;
  return { email: "", plan: null, previewsLeft: 3, previewsPerDay: 3, spentKes, spentUsd };
}

const PLAN_USD: Record<Plan, number> = { starter: 15, creator: 50, pro: 100, business: 350 };

/** Starts a plan checkout. Live: cards auto-renew; M-Pesa pays per period. */
export async function createPlanCheckout(input: { plan: Plan; billing: Billing; email: string; method: "card" | "mpesa" }): Promise<PlanCheckout> {
  if (API_MODE === "live") return call("POST", "/plans/checkout", input);
  const months = input.billing === "yearly" ? 10 : 1;
  const amountUsd = PLAN_USD[input.plan] * months;
  return { checkoutId: `demo-${Date.now()}`, amountUsd, amountKes: Math.ceil((amountUsd * 129.4) / 5) * 5 };
}

/**
 * Asks the server to verify a plan payment with Paystack (by reference) and report the plan's state.
 * Call after Paystack's onSuccess: webhooks do not reach this backend. Demo: always active.
 */
export async function confirmPlanCheckout(checkoutId: string): Promise<PlanConfirmation> {
  if (API_MODE === "live") return call("GET", `/plans/${encodeURIComponent(checkoutId)}`);
  await wait(400);
  return { checkoutId, status: "active", plan: "creator", billing: "monthly" };
}

export const PLAN_PRICES_USD = PLAN_USD;

// ---- transcription ----------------------------------------------------------
// Pay as you go, no account needed. The browser asks for an upload link, PUTs
// the file straight to Cloud Storage, then the server measures the length
// itself and prices it. Demo: every step runs in this browser; no file leaves it.

export type TranscriptStatus = "uploading" | "paying" | "transcribing" | "ready" | "failed";
export type TranscriptUpload = {
  transcriptId: string;
  uploadUrl: string;
  contentType: string;
  /** Every header the PUT must carry, exactly as signed (type, size range, write-once). */
  uploadHeaders?: Record<string, string>;
};
export type TranscriptQuote = { transcriptId: string; seconds: number; minutes: number; amountUsd: number; amountKes: number };
export type TranscriptCheckout = TranscriptQuote & { accessCode?: string };
export type TranscriptDownloads = { txt: string; srt: string; vtt: string };
export type Transcript = {
  transcriptId: string;
  status: TranscriptStatus;
  // Empty until the server has measured the file.
  seconds?: number | null;
  minutes?: number | null;
  amountUsd?: number | null;
  amountKes?: number | null;
  fileName?: string | null;
  words?: number | null;
  downloads?: TranscriptDownloads;
  /** The start of the plain-text transcript (the server caps it at 4,000 characters). */
  preview?: string;
  /** True when the preview is only the start; the TXT download has it all. */
  previewTruncated?: boolean;
  /** False while status is "paying" but Pay was never pressed: there is nothing to confirm. */
  checkoutStarted?: boolean;
  error?: string;
};
export type UploadProgress = { loaded: number; total: number };

/** True for the error uploadToStorage rejects with when its signal aborts. */
export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

const abortError = () => new DOMException("The upload was cancelled.", "AbortError");

/** The recording's length as the browser reads it from the file header; null when it can't tell. */
export function mediaDuration(file: File, timeoutMs = 8000): Promise<number | null> {
  return new Promise((resolve) => {
    let url = "";
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(null);
      return;
    }
    const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    let timer = 0;
    let done = false;
    const finish = (seconds: number | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      el.removeAttribute("src");
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    timer = window.setTimeout(() => finish(null), timeoutMs);
    el.preload = "metadata";
    el.muted = true;
    el.onloadedmetadata = () => finish(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : null);
    el.onerror = () => finish(null);
    el.src = url;
  });
}

const TRANSCRIPTS_KEY = "mv.transcripts";
const DEMO_UPLOAD = "demo-upload:";
const DEMO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  webm: "audio/webm",
  amr: "audio/amr",
  aiff: "audio/aiff",
  aif: "audio/aiff",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

type DemoTranscript = {
  transcriptId: string;
  status: TranscriptStatus;
  fileName: string;
  size: number;
  measured?: number;
  seconds?: number;
  minutes?: number;
  amountUsd?: number;
  amountKes?: number;
  paidAt?: number;
  createdAt: string;
};

function demoTranscript(id: string): DemoTranscript {
  const t = readList<DemoTranscript>(TRANSCRIPTS_KEY).find((x) => x.transcriptId === id);
  if (!t) throw new ApiError(404, "Transcript not found.");
  return t;
}

function saveDemoTranscript(t: DemoTranscript) {
  const rest = readList<DemoTranscript>(TRANSCRIPTS_KEY).filter((x) => x.transcriptId !== t.transcriptId);
  // Keep the last 20 so the demo store never grows without end.
  writeList(TRANSCRIPTS_KEY, [...rest, t].slice(-20));
}

function demoQuoteOut(t: DemoTranscript): TranscriptQuote {
  return { transcriptId: t.transcriptId, seconds: t.seconds ?? 0, minutes: t.minutes ?? 0, amountUsd: t.amountUsd ?? 0, amountKes: t.amountKes ?? 0 };
}

function demoPreview(fileName: string): string {
  return [
    `Demo transcript of ${fileName}`,
    "",
    "[00:00:00] Speaker 1: Good morning, everyone, and thank you for coming in today.",
    "",
    "[00:00:06] Speaker 2: Thank you. Habari zenu? Shall we start with this quarter's numbers?",
    "",
    "[00:00:13] Speaker 1: Yes. Sales in Nakuru and Eldoret grew by a third, mostly through M-Pesa orders.",
    "",
    "[00:00:22] Speaker 2: That's good news. What held us back?",
    "",
    "[00:00:26] Speaker 1: Deliveries. Two of our trucks were off the road for most of March.",
    "",
    "[00:00:33] Speaker 2: Then that is the first thing we fix.",
    "",
    "(This is the demo. In the live service, the words from your recording appear here.)",
    "",
  ].join("\n");
}

/** Step 1: registers the upload and returns a signed link to PUT the file to. */
export async function createTranscriptUpload(input: {
  fileName: string;
  size: number;
  email: string;
  language: string;
  speakers: boolean;
}): Promise<TranscriptUpload> {
  if (API_MODE === "live") return call("POST", "/transcripts/uploads", input);
  await wait(400);
  const ext = input.fileName.includes(".") ? input.fileName.split(".").pop()!.toLowerCase() : "";
  const contentType = DEMO_TYPES[ext];
  if (!contentType) throw new ApiError(400, "Upload MP3, M4A, AAC, WAV, FLAC, OGG, OPUS, WEBM, AMR, AIFF, MP4 or MOV.");
  if (input.size > MAX_UPLOAD_MB * 1024 * 1024) throw new ApiError(400, "Files can be up to 500 MB.");
  const t: DemoTranscript = {
    transcriptId: `demo-vt-${Date.now()}`,
    status: "uploading",
    fileName: input.fileName,
    size: input.size,
    createdAt: new Date().toISOString(),
  };
  saveDemoTranscript(t);
  return { transcriptId: t.transcriptId, uploadUrl: `${DEMO_UPLOAD}${t.transcriptId}`, contentType };
}

/**
 * Step 2: PUTs the file straight to Cloud Storage with exactly the headers step 1
 * returned (Content-Type, size range, write-once), or the signature fails.
 * Rejects with an AbortError when `signal` aborts, an ApiError when storage
 * refuses, and a plain Error when the connection drops.
 */
export function uploadToStorage(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress?: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (API_MODE === "demo" || url.startsWith(DEMO_UPLOAD)) return demoUpload(url.slice(DEMO_UPLOAD.length), file, onProgress, signal);
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    xhr.open("PUT", url);
    xhr.withCredentials = false;
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => onProgress?.({ loaded: e.loaded, total: e.lengthComputable ? e.total : file.size });
    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.({ loaded: file.size, total: file.size });
        resolve();
      } else {
        reject(new ApiError(xhr.status, "The upload didn't go through. Please try again."));
      }
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error("The upload stopped. Check your connection and try again."));
    };
    xhr.onabort = () => {
      cleanup();
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(file);
  });
}

async function demoUpload(id: string, file: File, onProgress?: (p: UploadProgress) => void, signal?: AbortSignal): Promise<void> {
  const length = mediaDuration(file);
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    await wait(90);
    if (signal?.aborted) throw abortError();
    onProgress?.({ loaded: Math.round((file.size * i) / steps), total: file.size });
  }
  const measured = await length;
  const t = demoTranscript(id);
  saveDemoTranscript({ ...t, measured: measured ?? undefined });
}

/** Step 3: the server measures the stored file and prices it. 400s explain the problem (too long, unreadable). */
export async function quoteTranscript(transcriptId: string): Promise<TranscriptQuote> {
  if (API_MODE === "live") return call("POST", `/transcripts/${encodeURIComponent(transcriptId)}/quote`);
  await wait(900);
  const t = demoTranscript(transcriptId);
  if (t.status !== "uploading" && t.status !== "paying") throw new ApiError(409, "This transcript is already paid for.");
  // No length from the header: guess from the size as a 128 kbps MP3.
  const seconds = t.measured ?? Math.max(30, t.size / 16000);
  if (seconds > MAX_TRANSCRIBE_HOURS * 3600 + 1) {
    throw new ApiError(400, "This recording is over 3 hours long. The most we take is 3 hours, so trim or split it first.");
  }
  const q = transcribeQuote(seconds);
  const priced: DemoTranscript = { ...t, status: "paying", seconds: q.seconds, minutes: q.minutes, amountUsd: q.usd, amountKes: q.kes };
  saveDemoTranscript(priced);
  return demoQuoteOut(priced);
}

/** Step 4: a Paystack access code for the quoted price. Demo: no access code. */
export async function transcriptCheckout(transcriptId: string): Promise<TranscriptCheckout> {
  if (API_MODE === "live") return call("POST", `/transcripts/${encodeURIComponent(transcriptId)}/checkout`);
  await wait(400);
  const t = demoTranscript(transcriptId);
  if (t.status !== "paying" || !t.amountKes) throw new ApiError(409, "Get a price for this file first.");
  return demoQuoteOut(t);
}

/** Demo only: marks a transcript paid, as Paystack would. It then transcribes and is ready a few seconds later. */
export function confirmDemoTranscriptPayment(transcriptId: string) {
  try {
    const t = demoTranscript(transcriptId);
    if (t.status === "paying" && !t.paidAt) saveDemoTranscript({ ...t, paidAt: Date.now() });
  } catch {
    // Unknown id: the status page says so.
  }
}

/** Step 5: progress, then the transcript. Polling this also confirms the payment with Paystack. */
export async function getTranscript(transcriptId: string): Promise<Transcript> {
  if (API_MODE === "live") return call("GET", `/transcripts/${encodeURIComponent(transcriptId)}`);
  await wait(250);
  let t = demoTranscript(transcriptId);
  if (t.paidAt && (t.status === "paying" || t.status === "transcribing")) {
    const since = Date.now() - t.paidAt;
    const next: TranscriptStatus = since > 10000 ? "ready" : since > 3000 ? "transcribing" : "paying";
    if (next !== t.status) {
      t = { ...t, status: next };
      saveDemoTranscript(t);
    }
  }
  const out: Transcript = { ...demoQuoteOut(t), status: t.status, fileName: t.fileName };
  if (t.status === "ready") {
    out.preview = demoPreview(t.fileName);
    out.words = out.preview.split(/\s+/).filter(Boolean).length;
  }
  return out;
}
