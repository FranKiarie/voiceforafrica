import { useCallback, useEffect, useState } from "react";
import { DrumRoll, PatternStrip, Shell } from "../components/Shell";
import { LIVE_ACCENTS, PURPOSES, VOICES, formatKes } from "../data";
import { setFlow } from "../flow";
import { API_MODE, ApiError, getAccount, listClips, type Account, type Clip, type Plan } from "../lib/api";
import { supabase, useSession } from "../lib/supabase";
import { Link, navigate } from "../router";
import { ClipRow, formatDate } from "./Clips";
import "./Clips.css";
import "./Dashboard.css";

const PLAN_NAME: Record<Plan, string> = { starter: "Starter", creator: "Creator", pro: "Pro", business: "Business" };
const RECENT = 4;
// The quick starts: the voice-over types people reach for most.
const QUICK = ["radio-ad", "documentary", "commercial", "explainer", "phone", "social"];

type State = { kind: "loading" } | { kind: "error" } | { kind: "signin" } | { kind: "ready"; account: Account; clips: Clip[] };

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function minutesMade(clips: Clip[]): string {
  const seconds = clips.reduce((sum, c) => sum + (c.seconds ?? 0), 0);
  if (seconds < 60) return `${seconds} s`;
  const m = seconds / 60;
  return `${m < 10 ? m.toFixed(1) : Math.round(m)} min`;
}

/** Opens the studio with one setting already chosen. */
function startWith(patch: { purpose?: string; voiceId?: string }) {
  setFlow(patch);
  navigate("/studio");
}

export default function Dashboard() {
  const session = useSession();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [playingId, setPlayingId] = useState<string | null>(null);

  const name = (session?.user?.user_metadata?.full_name as string | undefined)?.trim() ?? "";
  const first = name.split(/\s+/)[0] ?? "";
  const email = session?.user?.email ?? "";
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
  const stop = useCallback(() => setPlayingId(null), []);

  if (view.kind === "signin") {
    return (
      <Shell>
        <div className="dash">
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
  const plan = ready?.account.plan ?? null;
  const voiceCount = VOICES.length;

  return (
    <Shell>
      <div className="dash">
        {API_MODE === "demo" && <p className="faint clips-demo">Demo mode: showing clips made in this browser.</p>}

        <section className="dash-hero">
          <div>
            <p className="dash-eyebrow">{greeting().toUpperCase()}</p>
            <h1 className="dash-title">{first ? `Karibu, ${first}` : "Karibu"}</h1>
            <p className="muted">Your voice-overs, licences and plan in one place.</p>
          </div>
          <Link href="/studio" className="btn dash-new">
            New voice-over
          </Link>
        </section>

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
          <>
            <section className="dash-stats" aria-label="Your numbers">
              <div className="card dash-stat">
                <span className="dash-num">{ready.clips.length}</span>
                <span className="faint">Clips made</span>
              </div>
              <div className="card dash-stat">
                <span className="dash-num">{minutesMade(ready.clips)}</span>
                <span className="faint">Audio made</span>
              </div>
              <div className="card dash-stat">
                <span className="dash-num">
                  {ready.account.previewsLeft}
                  <span className="dash-of">{` of ${ready.account.previewsPerDay}`}</span>
                </span>
                <span className="faint">Free previews left today</span>
              </div>
              <div className="card dash-stat">
                <span className="dash-num">{formatKes(ready.account.spentKes)}</span>
                <span className="faint">Spent so far</span>
              </div>
            </section>

            <div className="dash-grid">
              <section className="dash-recent" aria-labelledby="recent-title">
                <div className="dash-section-head">
                  <h2 id="recent-title">Recent clips</h2>
                  {ready.clips.length > RECENT && <Link href="/clips">See all {ready.clips.length}</Link>}
                </div>
                {ready.clips.length === 0 ? (
                  <div className="card clips-empty">
                    <PatternStrip pattern="beads" height={12} />
                    <div className="clips-empty-body">
                      <p>No clips yet. Paste a script and hear 45 seconds free.</p>
                      <Link href="/studio" className="btn btn-outline">
                        Paste your script
                      </Link>
                    </div>
                  </div>
                ) : (
                  <ul className="clips-list" aria-label="Your recent clips">
                    {ready.clips.slice(0, RECENT).map((c) => (
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

              <aside className="dash-side">
                <section className="card dash-card" aria-labelledby="plan-title">
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
                        <p className="faint">KES 195 a minute, one language per clip. Plans start at $15 a month.</p>
                      </>
                    )}
                    <Link href="/pricing" className="btn btn-outline btn-block">
                      {plan ? "Change plan" : "See plans"}
                    </Link>
                  </div>
                </section>

                <section className="card dash-card" aria-labelledby="quick-title">
                  <div className="dash-card-body">
                    <h2 id="quick-title">Start from a type</h2>
                    <div className="dash-chips">
                      {QUICK.map((id) => {
                        const p = PURPOSES.find((x) => x.id === id);
                        return p ? (
                          <button key={id} type="button" className="dash-chip" onClick={() => startWith({ purpose: id })}>
                            {p.label}
                          </button>
                        ) : null;
                      })}
                    </div>
                  </div>
                </section>

                <section className="card dash-card" aria-labelledby="accents-title">
                  <div className="dash-card-body">
                    <h2 id="accents-title">Voices</h2>
                    <p className="faint">{`${voiceCount} voices in ${LIVE_ACCENTS.length} African accents.`}</p>
                    <div className="dash-chips">
                      {LIVE_ACCENTS.map((a) => {
                        const v = VOICES.find((x) => x.accent === a.id);
                        return v ? (
                          <button key={a.id} type="button" className="dash-chip" onClick={() => startWith({ voiceId: v.id })}>
                            {a.label}
                          </button>
                        ) : null;
                      })}
                    </div>
                  </div>
                </section>
              </aside>
            </div>
          </>
        )}

        {session && (
          <p className="faint dash-who">
            <span>{`Signed in as ${email || "your account"}`}</span>
            <button type="button" className="clips-text-btn" onClick={() => void supabase.auth.signOut()}>
              Sign out
            </button>
          </p>
        )}
      </div>
    </Shell>
  );
}
