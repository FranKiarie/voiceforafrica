import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AppShell } from "../components/AppShell";
import { Icon, type IconName } from "../components/icons";
import { Drum, DrumRoll, PatternStrip, Shell } from "../components/Shell";
import { UsageChart, lastDays } from "../components/UsageChart";
import {
  KES_PER_USD,
  LIVE_ACCENTS,
  MAX_PAYG_CHARS,
  PAYG_PRICE,
  PURPOSES,
  VOICES,
  accentLabel,
  formatDuration,
  formatKes,
  formatUsd,
  quoteFor,
  type Voice,
} from "../data";
import { getFlow, setFlow } from "../flow";
import { API_MODE, ApiError, getAccount, listClips, type Account, type Clip, type Plan } from "../lib/api";
import { useVoiceSample } from "../lib/sample";
import { useSession } from "../lib/supabase";
import { Link, navigate } from "../router";
import { ClipRow, formatDate } from "./Clips";
import "./Clips.css";
import "./Dashboard.css";

const PLAN_NAME: Record<Plan, string> = { starter: "Starter", creator: "Creator", pro: "Pro", business: "Business" };
const RECENT = 5;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// The voice-over types people reach for most, with their icons.
const TYPES: [string, IconName][] = [
  ["radio-ad", "radio"],
  ["commercial", "tv"],
  ["documentary", "film"],
  ["explainer", "play"],
  ["phone", "phone"],
  ["story", "book"],
];
// Voices offered until the account has favourites of its own: one per region, all with samples.
const SUGGESTED = ["wanjiru", "funmi", "kwame", "nakato", "awa", "selam"];

type State = { kind: "loading" } | { kind: "error" } | { kind: "signin" } | { kind: "ready"; account: Account; clips: Clip[] };

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  const d = new Date();
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function minutesMade(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = seconds / 60;
  return `${m < 10 ? m.toFixed(1) : Math.round(m)} min`;
}

const totalSeconds = (clips: Clip[]) => clips.reduce((sum, c) => sum + (c.seconds ?? 0), 0);

/** Opens the studio with some settings already chosen. */
function startWith(patch: { purpose?: string; voiceId?: string }) {
  setFlow(patch);
  navigate("/studio");
}

/** Paste a script here and carry on in the studio, where the email and terms are confirmed. */
function QuickStart() {
  const [script, setScript] = useState(() => getFlow().script);
  const [purpose, setPurpose] = useState(() => getFlow().purpose);
  const [voiceId, setVoiceId] = useState(() => getFlow().voiceId);
  const q = quoteFor(script);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFlow({ script, purpose, voiceId });
    navigate("/studio");
  };

  return (
    <form className="card dash-quick" onSubmit={submit} aria-labelledby="quick-title">
      <div className="dash-card-head">
        <h2 id="quick-title">Start a voice-over</h2>
        <span className="faint">Hear 45 seconds free first</span>
      </div>
      <label className="sr-only" htmlFor="dash-script">
        Script
      </label>
      <textarea
        id="dash-script"
        className="dash-script"
        rows={4}
        value={script}
        maxLength={MAX_PAYG_CHARS}
        placeholder="Paste the words you want spoken…"
        onChange={(e) => setScript(e.target.value)}
      />
      <div className="dash-quick-row">
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
        <label className="field">
          Voice
          <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
            {LIVE_ACCENTS.map((a) => (
              <optgroup key={a.id} label={a.label}>
                {VOICES.filter((v) => v.accent === a.id).map((v) => (
                  <option key={v.id} value={v.id}>
                    {`${v.name} · ${v.gender}`}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-ink dash-continue">
          Continue
          <Icon name="arrow" size={18} />
        </button>
      </div>
      <p className="faint dash-quick-note" aria-live="polite">
        {q.chars > 0
          ? `${q.chars.toLocaleString("en-US")} characters · about ${formatDuration(q.projectedSeconds)} · ${formatUsd(q.usd)} for the full clip`
          : `${PAYG_PRICE} after your free preview.`}
      </p>
    </form>
  );
}

function Stat({ icon, label, value, note }: { icon: IconName; label: string; value: ReactNode; note: ReactNode }) {
  return (
    <div className="card dash-stat">
      <span className="dash-stat-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="dash-stat-label faint">{label}</span>
      <span className="dash-num">{value}</span>
      <span className="dash-stat-note faint">{note}</span>
    </div>
  );
}

/** The account's most-used voices, topped up with one suggestion per region. */
function YourVoices({ clips }: { clips: Clip[] }) {
  const [playing, toggle] = useVoiceSample();
  const picks = useMemo(() => {
    const uses = new Map<string, number>();
    for (const c of clips) {
      const v = VOICES.find((x) => x.name === c.voice);
      if (v) uses.set(v.id, (uses.get(v.id) ?? 0) + 1);
    }
    const used = [...uses].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ voice: VOICES.find((v) => v.id === id)!, n }));
    const out: { voice: Voice; n: number }[] = used.slice(0, 4);
    for (const id of SUGGESTED) {
      if (out.length >= 4) break;
      if (out.some((p) => p.voice.id === id)) continue;
      const v = VOICES.find((x) => x.id === id);
      if (v) out.push({ voice: v, n: 0 });
    }
    return out;
  }, [clips]);

  return (
    <section className="card dash-card" aria-labelledby="voices-title">
      <div className="dash-card-head">
        <h2 id="voices-title">{picks.some((p) => p.n > 0) ? "Your voices" : "Voices to try"}</h2>
        <Link href="/voices">All {VOICES.length}</Link>
      </div>
      <ul className="dash-voices">
        {picks.map(({ voice: v, n }) => {
          const on = playing === v.id;
          return (
            <li key={v.id}>
              {v.sample ? (
                <Drum size={38} playing={on} label={on ? `Pause ${v.name}` : `Play ${v.name}`} onClick={() => toggle(v.id)} />
              ) : (
                <span className="voice-nosample dash-nosample" aria-hidden="true" />
              )}
              <span className="dash-voice-text">
                <span className="dash-voice-name">{v.name}</span>
                <span className="faint">
                  {`${accentLabel(v.accent)} · ${n ? `${n} ${n === 1 ? "clip" : "clips"}` : v.style}`}
                </span>
              </span>
              <button type="button" className="dash-use" onClick={() => startWith({ voiceId: v.id })} aria-label={`Use ${v.name}`}>
                Use
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PlanCard({ account }: { account: Account }) {
  const plan = account.plan;
  return (
    <section className="card dash-card dash-plan-card" aria-labelledby="plan-title">
      <PatternStrip pattern="kente" height={8} />
      <div className="dash-card-body">
        <h2 id="plan-title">Your plan</h2>
        {plan ? (
          <>
            <p className="dash-plan">{`${PLAN_NAME[plan.plan]} · ${plan.billing === "yearly" ? "yearly" : "monthly"}`}</p>
            {plan.periodEnd && <p className="faint">{`Renews ${formatDate(plan.periodEnd)}`}</p>}
          </>
        ) : (
          <>
            <p className="dash-plan">Pay as you go</p>
            <p className="faint">{`${PAYG_PRICE}, one language per clip. Plans start at $15 a month.`}</p>
          </>
        )}
        <Link href="/pricing" className="btn btn-outline btn-block">
          {plan ? "Change plan" : "See plans"}
        </Link>
      </div>
    </section>
  );
}

function Types() {
  return (
    <section className="card dash-card" aria-labelledby="types-title">
      <div className="dash-card-head">
        <h2 id="types-title">Start from a type</h2>
      </div>
      <ul className="dash-types">
        {TYPES.map(([id, icon]) => {
          const p = PURPOSES.find((x) => x.id === id);
          return p ? (
            <li key={id}>
              <button type="button" onClick={() => startWith({ purpose: id })}>
                <span className="dash-type-icon">
                  <Icon name={icon} size={18} />
                </span>
                <span className="dash-type-label">{p.label}</span>
                <Icon name="arrow" size={16} className="dash-type-arrow" />
              </button>
            </li>
          ) : null;
        })}
      </ul>
    </section>
  );
}

export default function Dashboard() {
  const session = useSession();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [playingId, setPlayingId] = useState<string | null>(null);

  const name = (session?.user?.user_metadata?.full_name as string | undefined)?.trim() ?? "";
  const first = name.split(/\s+/)[0] ?? "";
  // Live mode waits for the account; demo mode reads this browser either way.
  const authKey = API_MODE === "demo" ? "demo" : session === undefined ? "loading" : session ? session.user.id : "out";

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const [account, clips] = await Promise.all([getAccount(), listClips()]);
      setState({ kind: "ready", account, clips });
    } catch (e) {
      if (API_MODE === "live" && e instanceof ApiError && e.status === 401) setState({ kind: "signin" });
      else setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    if (authKey === "loading") return;
    if (authKey === "out") {
      setState({ kind: "signin" });
      return;
    }
    void load();
  }, [authKey, load]);

  const view: State = authKey === "loading" ? { kind: "loading" } : authKey === "out" ? { kind: "signin" } : state;
  // The sidebar is for signed-in accounts only: Shell shows it once a session exists. The demo has no session.
  const Frame = API_MODE === "demo" ? AppShell : Shell;
  const stop = useCallback(() => setPlayingId(null), []);
  const clips = view.kind === "ready" ? view.clips : [];
  const days = useMemo(() => lastDays(clips), [clips]);

  if (view.kind === "signin") {
    return (
      <Shell>
        <div className="dash-signin">
          <div className="card clips-empty">
            <div className="clips-empty-body">
              <p>Sign in to see your dashboard.</p>
              <div className="clips-actions">
                <Link href="/signin?next=/dashboard" className="btn">
                  Sign in
                </Link>
                <Link href="/signup" className="btn btn-outline">
                  Create an account
                </Link>
              </div>
            </div>
          </div>
        </div>
      </Shell>
    );
  }

  const ready = view.kind === "ready" ? view : null;
  const weekAgo = Date.now() - WEEK_MS;
  const thisWeek = clips.filter((c) => new Date(c.createdAt).getTime() >= weekAgo);
  const seconds = totalSeconds(clips);
  const monthSeconds = totalSeconds(clips.filter((c) => new Date(c.createdAt).getTime() >= days[0].date.getTime()));

  return (
    <Frame>
      <div className="dash">
        {API_MODE === "demo" && <p className="faint clips-demo">Demo mode: showing clips made in this browser.</p>}

        <header className="dash-hero">
          <div className="dash-hero-text">
            <p className="dash-eyebrow">{`Voice for Africa · ${greeting()}, ${todayLabel()}`}</p>
            <h1 className="dash-title">{first ? `Karibu, ${first}` : "Karibu"}</h1>
            <p className="dash-tagline hand">
              African voices, given a platform.
              <svg className="dash-brush" viewBox="0 0 300 12" preserveAspectRatio="none" aria-hidden="true">
                <path d="M3 8 C 70 2, 150 11, 297 4" />
              </svg>
            </p>
          </div>
          <div className="dash-hero-strip" aria-hidden="true">
            <PatternStrip pattern="kente" height={10} />
          </div>
        </header>

        {ready && (
          <section className="dash-stats" aria-label="Your numbers">
            <Stat
              icon="wave"
              label="Audio made"
              value={minutesMade(seconds)}
              note={thisWeek.length ? `${minutesMade(totalSeconds(thisWeek))} this week` : "None this week"}
            />
            <Stat
              icon="play"
              label="Clips"
              value={clips.length.toLocaleString("en-US")}
              note={thisWeek.length ? `${thisWeek.length} this week` : "None this week"}
            />
            <Stat
              icon="mic"
              label="Free previews today"
              value={
                <>
                  {ready.account.previewsLeft}
                  <span className="dash-of">{` of ${ready.account.previewsPerDay}`}</span>
                </>
              }
              note={
                <span
                  className="dash-pips"
                  role="meter"
                  aria-label="Free previews left today"
                  aria-valuemin={0}
                  aria-valuemax={ready.account.previewsPerDay}
                  aria-valuenow={ready.account.previewsLeft}
                >
                  {Array.from({ length: ready.account.previewsPerDay }, (_, i) => (
                    <span key={i} className={i < ready.account.previewsLeft ? "on" : undefined} />
                  ))}
                </span>
              }
            />
            <Stat
              icon="card"
              label="Spent so far"
              value={formatUsd(ready.account.spentUsd ?? Math.round((ready.account.spentKes / KES_PER_USD) * 100) / 100)}
              note={ready.account.spentKes ? `Paid as ${formatKes(ready.account.spentKes)}` : "Nothing yet"}
            />
          </section>
        )}

        <div className="dash-grid">
          <div className="dash-main">
            <QuickStart />

            {view.kind === "loading" && (
              <div className="clips-status" role="status">
                <DrumRoll />
                <span className="muted">Loading your dashboard…</span>
              </div>
            )}

            {view.kind === "error" && (
              <div className="clips-status">
                <p role="alert" className="clips-error">
                  We couldn't load your dashboard.
                </p>
                <button type="button" className="btn btn-outline" onClick={() => void load()}>
                  Try again
                </button>
              </div>
            )}

            {ready && (
              <section className="card dash-chart" aria-labelledby="chart-title">
                <div className="dash-card-head">
                  <div>
                    <h2 id="chart-title">Audio made</h2>
                    <span className="faint">Last 30 days</span>
                  </div>
                  <span className="dash-chart-total">{monthSeconds ? formatDuration(monthSeconds) : "0 s"}</span>
                </div>
                <UsageChart days={days} />
              </section>
            )}

            {ready && (
              <section className="dash-recent" aria-labelledby="recent-title">
                <div className="dash-section-head">
                  <h2 id="recent-title">Recent clips</h2>
                  {clips.length > 0 && <Link href="/clips">{clips.length > RECENT ? `See all ${clips.length}` : "My clips"}</Link>}
                </div>
                {clips.length === 0 ? (
                  <div className="card clips-empty">
                    <PatternStrip pattern="beads" height={12} />
                    <div className="clips-empty-body">
                      <p>No clips yet. Paste a script above and hear 45 seconds free.</p>
                    </div>
                  </div>
                ) : (
                  <ul className="clips-list" aria-label="Your recent clips">
                    {clips.slice(0, RECENT).map((c) => (
                      <ClipRow
                        key={c.id}
                        clip={c}
                        playing={playingId === c.id}
                        onToggle={() => setPlayingId((p) => (p === c.id ? null : c.id))}
                        onEnded={stop}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>

          <aside className="dash-side" aria-label="Voices and plan">
            {ready && <YourVoices clips={clips} />}
            {ready && <PlanCard account={ready.account} />}
            <Types />
          </aside>
        </div>
      </div>
    </Frame>
  );
}
