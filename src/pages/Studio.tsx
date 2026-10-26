import { useState, type FormEvent } from "react";
import { Shell } from "../components/Shell";
import { Link, navigate } from "../router";
import { LANGUAGES, MAX_PAYG_CHARS, PURPOSES, VOICES, formatDuration, quoteFor } from "../data";
import { setFlow, useFlow } from "../flow";
import { ApiError, createPreview, type Preview } from "../lib/api";
import { useVoiceSample } from "../lib/sample";
import { supabase, useSession } from "../lib/supabase";
import "./Studio.css";

const PREVIEW_KEY = "mv.previews";
const PREVIEWS_PER_DAY = 3;
const MIN_SCRIPT_CHARS = 20;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function previewsUsedToday(): number {
  try {
    const raw = localStorage.getItem(PREVIEW_KEY);
    if (!raw) return 0;
    const saved = JSON.parse(raw) as { date?: string; count?: number };
    return saved.date === today() && typeof saved.count === "number" ? saved.count : 0;
  } catch {
    return 0;
  }
}

function recordPreview(count: number) {
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify({ date: today(), count }));
  } catch {
    // Storage blocked: the counter simply resets.
  }
}

// The preview the Listen and Pay pages use, kept for this tab only.
const CURRENT_PREVIEW_KEY = "mv.preview";

function savePreview(p: Preview) {
  try {
    sessionStorage.setItem(
      CURRENT_PREVIEW_KEY,
      JSON.stringify({ previewId: p.previewId, seconds: p.seconds, audioUrl: p.audioUrl }),
    );
  } catch {
    // Storage blocked: Listen asks for the preview again.
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TEXT_BTN = {
  background: "none",
  border: 0,
  padding: 0,
  font: "inherit",
  color: "inherit",
  fontWeight: 600,
  textDecoration: "underline",
  textUnderlineOffset: 3,
  cursor: "pointer",
} as const;

export default function Studio() {
  const flow = useFlow();
  const [language, setLanguage] = useState(flow.language);
  const [voiceId, setVoiceId] = useState(flow.voiceId);
  const [purpose, setPurpose] = useState(flow.purpose);
  const [sampling, toggleSample] = useVoiceSample();
  const [script, setScript] = useState(flow.script);
  const [email, setEmail] = useState(flow.email);
  // Signed in: the account email is used and locked. Signed out: type any email.
  const session = useSession();
  const accountEmail = session?.user?.email ?? "";
  const useEmail = accountEmail || email;
  const [adult, setAdult] = useState(flow.adult);
  const [used, setUsed] = useState(previewsUsedToday);
  const [limitHit, setLimitHit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const lang = LANGUAGES.find((l) => l.code === language);
  const voice = VOICES.find((v) => v.id === voiceId) ?? VOICES[0];
  const q = quoteFor(script);
  const left = Math.max(0, PREVIEWS_PER_DAY - used);
  const ready = q.chars >= MIN_SCRIPT_CHARS && EMAIL_RE.test(useEmail.trim()) && adult;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    const count = previewsUsedToday();
    if (count >= PREVIEWS_PER_DAY) {
      setUsed(count);
      setLimitHit(true);
      return;
    }
    setBusy(true);
    setError("");
    const trimmed = useEmail.trim();
    try {
      const preview = await createPreview({ script, voiceId, language, email: trimmed, purpose });
      recordPreview(count + 1);
      setUsed(count + 1);
      savePreview(preview);
      setFlow({ language, voiceId, purpose, script, email: trimmed, adult: true });
      navigate("/listen");
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 429) {
        // The server counts by email and network too, so trust it over this browser's count.
        recordPreview(PREVIEWS_PER_DAY);
        setUsed(PREVIEWS_PER_DAY);
        setLimitHit(true);
      } else if (err instanceof ApiError && err.status < 500) {
        setError(err.message);
      } else if (err instanceof ApiError) {
        setError("We couldn't make your preview just now. Please try again in a minute.");
      } else {
        setError("We couldn't reach the server. Check your connection and try again.");
      }
    }
  };

  return (
    <Shell step={1} footer={false}>
      <form className="narrow studio" onSubmit={(e) => void submit(e)} noValidate>
        <h1 className="studio-title">Paste your script</h1>

        <label className="field">
          What's it for?
          <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {PURPOSES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <div className="studio-row">
          <label className="field">
            Language
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.en ? `${l.own} (${l.en})` : l.own}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Voice
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
              {(["Female", "Male"] as const).map((g) => (
                <optgroup key={g} label={g}>
                  {VOICES.filter((v) => v.gender === g).map((v) => (
                    <option key={v.id} value={v.id}>
                      {`${v.name} · ${v.style}`}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
        {voice.sample ? (
          <button
            type="button"
            className="studio-sample"
            aria-pressed={sampling === voice.id}
            onClick={() => toggleSample(voice.id)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              {sampling === voice.id ? (
                <path d="M7 5 h3 v14 h-3 Z M14 5 h3 v14 h-3 Z" fill="currentColor" />
              ) : (
                <path d="M8 5 L19 12 L8 19 Z" fill="currentColor" />
              )}
            </svg>
            {sampling === voice.id ? `Stop ${voice.name}` : `Hear ${voice.name}`}
            <span className="faint">{` · ${voice.gender} · Kenyan accent`}</span>
          </button>
        ) : (
          <p className="studio-sample faint">{`${voice.name} · ${voice.gender} · Kenyan accent · sample coming soon`}</p>
        )}
        {lang?.premiumOnly && (
          <p className="faint studio-hint">
            {lang.own} uses our Premium voice engine; same price on pay as you go.
          </p>
        )}

        <div className="studio-script">
          <label className="field">
            Script
            <textarea
              rows={9}
              value={script}
              maxLength={MAX_PAYG_CHARS}
              placeholder="Paste the words you want spoken…"
              onChange={(e) => setScript(e.target.value)}
              aria-describedby="script-count"
            />
          </label>
          <p id="script-count" className="faint studio-count" aria-live="polite">
            {q.chars.toLocaleString("en-KE")} characters · about {formatDuration(q.projectedSeconds)}
          </p>
        </div>

        <label className="field">
          Email for your download link
          {accountEmail ? (
            <input type="email" value={accountEmail} readOnly aria-readonly="true" aria-describedby="studio-account" />
          ) : (
            <input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </label>
        {accountEmail && (
          <p id="studio-account" className="faint studio-hint">
            Using {accountEmail} · Not you?{" "}
            <button type="button" style={TEXT_BTN} onClick={() => void supabase.auth.signOut().catch(() => undefined)}>
              Sign out
            </button>
          </p>
        )}

        <label className="studio-check">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} required />
          <span>
            I'm 18 or older and accept the <Link href="/terms">Terms</Link>
          </span>
        </label>

        {limitHit || left === 0 ? (
          <p className="studio-limit" role="status">
            You've used today's 3 free previews. Come back tomorrow for more, or write to us if you need help now.
          </p>
        ) : null}

        {error && (
          <p className="studio-error" role="alert">
            {error}
          </p>
        )}

        <div className="studio-submit">
          <button
            type="submit"
            className="btn btn-block"
            disabled={!ready || left === 0 || busy}
            aria-busy={busy || undefined}
          >
            {busy ? "Getting your preview…" : "Hear 45 seconds free"}
          </button>
          <p className="faint center studio-note">
            Then KES 195 a minute if you like it · {left} free {left === 1 ? "preview" : "previews"} left today
          </p>
        </div>
      </form>
    </Shell>
  );
}
