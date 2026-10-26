import { useState, type FormEvent } from "react";
import { Shell } from "../components/Shell";
import { Link, navigate } from "../router";
import { LANGUAGES, MAX_PAYG_CHARS, VOICES, formatDuration, quoteFor } from "../data";
import { setFlow, useFlow } from "../flow";
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Studio() {
  const flow = useFlow();
  const [language, setLanguage] = useState(flow.language);
  const [voiceId, setVoiceId] = useState(flow.voiceId);
  const [script, setScript] = useState(flow.script);
  const [email, setEmail] = useState(flow.email);
  const [adult, setAdult] = useState(flow.adult);
  const [used, setUsed] = useState(previewsUsedToday);
  const [limitHit, setLimitHit] = useState(false);

  const lang = LANGUAGES.find((l) => l.code === language);
  const q = quoteFor(script);
  const left = Math.max(0, PREVIEWS_PER_DAY - used);
  const ready = q.chars >= MIN_SCRIPT_CHARS && EMAIL_RE.test(email.trim()) && adult;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    const count = previewsUsedToday();
    if (count >= PREVIEWS_PER_DAY) {
      setUsed(count);
      setLimitHit(true);
      return;
    }
    recordPreview(count + 1);
    setUsed(count + 1);
    setFlow({ language, voiceId, script, email: email.trim(), adult: true });
    navigate("/listen");
  };

  return (
    <Shell step={1} footer={false}>
      <form className="narrow studio" onSubmit={submit} noValidate>
        <h1 className="studio-title">Paste your script</h1>

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
              {VOICES.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
        </div>
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
          <input
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

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

        <div className="studio-submit">
          <button type="submit" className="btn btn-block" disabled={!ready || left === 0}>
            Hear 45 seconds free
          </button>
          <p className="faint center studio-note">
            Then KES 195 a minute if you like it · {left} free {left === 1 ? "preview" : "previews"} left today
          </p>
        </div>
      </form>
    </Shell>
  );
}
