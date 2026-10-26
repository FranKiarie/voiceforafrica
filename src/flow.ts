import { useSyncExternalStore } from "react";

// State for one try-before-you-pay job, shared across the Studio, Listen, Pay
// and Ready pages. Kept in sessionStorage so a refresh doesn't lose the script.
export type Flow = {
  language: string;
  voiceId: string;
  script: string;
  email: string;
  adult: boolean;
  jobId?: string;
  paidKes?: number;
  paymentRef?: string;
  licenceId?: string;
};

const KEY = "mv.flow";
const EMPTY: Flow = { language: "en", voiceId: "sw-ke-csagent-4", script: "", email: "", adult: false };

let state: Flow = load();
const listeners = new Set<() => void>();

function load(): Flow {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
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
