import { useSyncExternalStore } from "react";
import { DEFAULT_PURPOSE, DEFAULT_VOICE, PURPOSES, VOICES } from "./data";

// State for one try-before-you-pay job, shared across the Studio, Listen, Pay
// and Ready pages. Kept in sessionStorage so a refresh doesn't lose the script.
export type Flow = {
  language: string;
  voiceId: string;
  purpose: string;
  script: string;
  email: string;
  adult: boolean;
  jobId?: string;
  paidKes?: number;
  paymentRef?: string;
  licenceId?: string;
};

const KEY = "mv.flow";
const EMPTY: Flow = { language: "en", voiceId: DEFAULT_VOICE, purpose: DEFAULT_PURPOSE, script: "", email: "", adult: false };

let state: Flow = load();
const listeners = new Set<() => void>();

function load(): Flow {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const saved: Flow = { ...EMPTY, ...JSON.parse(raw) };
    // A tab from before the voice names were introduced may hold an old voice id.
    if (!VOICES.some((v) => v.id === saved.voiceId)) saved.voiceId = DEFAULT_VOICE;
    if (!PURPOSES.some((p) => p.id === saved.purpose)) saved.purpose = DEFAULT_PURPOSE;
    return saved;
  } catch {
    return EMPTY;
  }
}

export function getFlow(): Flow {
  return state;
}

export function setFlow(patch: Partial<Flow>) {
  state = { ...state, ...patch };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode: keep it in memory only.
  }
  listeners.forEach((l) => l());
}

export function resetFlow() {
  setFlow({ ...EMPTY });
}

export function useFlow(): Flow {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
