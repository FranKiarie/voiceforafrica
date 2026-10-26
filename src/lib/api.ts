// The one place the frontend talks to the voice backend.
//
// Live mode: VITE_API_BASE is set (the Fly app, e.g. https://api.voice.mikaka.io).
// Demo mode: no base URL, so every call is answered in the browser. The demo
// keeps licences and clips in localStorage and never moves money or makes audio.

import { formatDuration, quoteFor, VOICES } from "../data";
import { accessToken, supabase } from "./supabase";

const BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");
export const API_MODE: "live" | "demo" = BASE ? "live" : "demo";

export type Preview = { previewId: string; seconds: number; audioUrl?: string };
export type PaygCheckout = { jobId: string; amountKes: number; accessCode?: string };
export type JobStatus = "paying" | "generating" | "ready" | "failed";
export type Job = { jobId: string; status: JobStatus; seconds?: number; audioUrl?: string; licenceId?: string };
export type Licence = { id: string; tier: string; voice: string; length: string; issued: string; paidKes?: number };
export type Clip = { id: string; licenceId: string; voice: string; length: string; createdAt: string; tier: string; audioUrl?: string };
export type Plan = "starter" | "creator" | "pro" | "business";
export type Billing = "monthly" | "yearly";
export type PlanCheckout = { checkoutId: string; amountKes: number; amountUsd: number; accessCode?: string };

export type PlanStatus = "pending" | "active" | "expired" | "failed";
export type PlanConfirmation = { checkoutId: string; status: PlanStatus; plan: Plan; billing: Billing; periodEnd?: string };
export type Session = { accessToken: string; expiresAt: number; email?: string };

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
