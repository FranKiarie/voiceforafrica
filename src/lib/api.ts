// The one place the frontend talks to the voice backend.
//
// Live mode (the default): same-origin /api functions on Vercel, or VITE_API_BASE
// if a separate backend is ever pointed here. The server prices the clip, checks
// Paystack, and only then returns audio.
// Demo mode (VITE_API_MODE=demo): no audio and no money, for layout work only.

import { formatDuration, quoteFor, VOICES } from "../data";

const BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");
export const API_MODE: "live" | "demo" = import.meta.env.VITE_API_MODE === "demo" ? "demo" : "live";

export type Preview = { previewId: string; seconds: number; audioUrl?: string; mime?: string };
export type PaygCheckout = { jobId: string; amountKes: number; accessCode?: string };
export type JobStatus = "paying" | "generating" | "ready" | "failed";
export type Job = {
  jobId: string;
  status: JobStatus;
  seconds?: number;
  audioUrl?: string;
  licenceId?: string;
  mime?: string;
  error?: string;
  refunded?: boolean;
};
export type Licence = { id: string; tier: string; voice: string; length: string; issued: string; paidKes?: number };
export type Clip = { id: string; licenceId: string; voice: string; length: string; createdAt: string; tier: string; audioUrl?: string };
export type Plan = "starter" | "creator" | "pro" | "business";
export type Billing = "monthly" | "yearly";
export type PlanCheckout = { checkoutId: string; amountKes: number; amountUsd: number; accessCode?: string };

export type PlanStatus = "pending" | "active" | "expired" | "failed";
export type PlanConfirmation = { checkoutId: string; status: PlanStatus; plan: Plan; billing: Billing; periodEnd?: string };
export type Session = { accessToken: string; expiresAt: number; email?: string };

// ---- session --------------------------------------------------------------
// The magic link lands on /clips#access_token=…&expires_in=…  (Supabase implicit flow).
// We keep the token in localStorage and strip it from the address bar.

const SESSION_KEY = "mv.session";

function jwtEmail(token: string): string | undefined {
  try {
    const part = token.split(".")[1];
    if (!part) return undefined;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(
      Array.from(atob(padded), (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
    );
    const email = (JSON.parse(json) as { email?: unknown }).email;
    return typeof email === "string" && email ? email : undefined;
  } catch {
    return undefined;
  }
}

function captureSessionFromHash() {
  if (typeof window === "undefined") return;
  const hash = window.location.hash;
  if (!hash || !hash.includes("access_token")) return;
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  if (accessToken) {
    const expiresIn = Number(params.get("expires_in"));
    const session: Session = {
      accessToken,
      expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000,
      email: jwtEmail(accessToken),
    };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // Private mode: nothing is kept, so the user signs in again next time.
    }
  }
  try {
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  } catch {
    // ignore
  }
}

captureSessionFromHash();

/** The stored session, or null when signed out or expired. */
export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session>;
    if (typeof s.accessToken !== "string" || typeof s.expiresAt !== "number") return null;
    if (s.expiresAt <= Date.now()) return null;
    return { accessToken: s.accessToken, expiresAt: s.expiresAt, email: s.email };
  } catch {
    return null;
  }
}

export function isSignedIn(): boolean {
  return getSession() !== null;
}

export function signOut() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
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
  const session = getSession();
  if (session) headers.Authorization = `Bearer ${session.accessToken}`;
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

type DemoJob = Job & { voice: string; paidKes: number; createdAt: string };

const voiceName = (id: string) => VOICES.find((v) => v.id === id)?.name ?? id;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- endpoints ------------------------------------------------------------

/** Free preview: at least 45 s of the script (the whole clip if shorter). */
export async function createPreview(input: { script: string; voiceId: string; language: string; email: string }): Promise<Preview> {
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
}): Promise<PaygCheckout> {
  if (API_MODE === "live") return call("POST", "/payg/checkout", input);
  const q = quoteFor(input.script);
  const job: DemoJob = {
    jobId: `demo-${Date.now()}`,
    status: "paying",
    seconds: q.projectedSeconds,
    voice: voiceName(input.voiceId),
    paidKes: q.kes,
    createdAt: new Date().toISOString(),
  };
  writeList(JOBS_KEY, [...readList<DemoJob>(JOBS_KEY), job]);
  return { jobId: job.jobId, amountKes: q.kes };
}

/** Demo only: marks a job paid, as the Paystack webhook would on the server. */
export function confirmDemoPayment(jobId: string) {
  const jobs = readList<DemoJob>(JOBS_KEY).map((j) => (j.jobId === jobId && j.status === "paying" ? { ...j, status: "generating" as const } : j));
  writeList(JOBS_KEY, jobs);
}

export type ClaimInput = { script: string; voiceId: string; language: string };

/** Poll after payment until status is "ready" (or "failed"). Live mode re-checks Paystack. */
export async function getJob(jobId: string, claim?: ClaimInput): Promise<Job> {
  if (API_MODE === "live") {
    return call("POST", "/jobs/claim", {
      reference: jobId,
      script: claim?.script ?? "",
      voiceId: claim?.voiceId ?? "",
      language: claim?.language ?? "",
    });
  }
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
    return done;
  }
  return job;
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
      createdAt: j.createdAt,
      tier: "Commercial",
    }))
    .reverse();
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
