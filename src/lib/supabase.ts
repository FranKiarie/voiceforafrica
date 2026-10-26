import { createClient, type Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

// Public values: the anon key only works within row-level security, and every
// voice table is server-only. Sign in, sign up and sessions live in Supabase Auth.
const URL = import.meta.env.VITE_SUPABASE_URL ?? "https://fiiyrrdrgsxkpxqqzbxw.supabase.co";
const ANON =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpaXlycmRyZ3N4a3B4cXF6Ynh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMwNDAzODAsImV4cCI6MjEwODYxNjM4MH0.MPirGr2gsXGEgk2tYpeEUR7-nYEYFvf7fDaQgZZk_Xc";

export const supabase = createClient(URL, ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
});

/** Current Supabase session, kept up to date. `undefined` while loading. */
export function useSession(): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  return session;
}

/** Bearer token for the voice backend, refreshed by supabase-js when needed. */
export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export const SITE_URL = typeof window !== "undefined" ? window.location.origin : "https://voice.mikaka.io";
