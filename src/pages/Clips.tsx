import { useCallback, useEffect, useRef, useState } from "react";
import { Drum, DrumRoll, PatternStrip, Shell } from "../components/Shell";
import { API_MODE, ApiError, listClips, type Clip } from "../lib/api";
import { supabase, useSession } from "../lib/supabase";
import { Link } from "../router";
import "./Clips.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NO_AUDIO = "Audio arrives when the voice service is live";

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "signin" }
  | { kind: "ready"; clips: Clip[] };

export function ClipRow({ clip, playing, onToggle, onEnded }: { clip: Clip; playing: boolean; onToggle: () => void; onEnded: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const hasAudio = Boolean(clip.audioUrl);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    if (playing) el.play().catch(onEnded);
    else el.pause();
  }, [playing, onEnded]);

  const date = formatDate(clip.createdAt);
  const meta = `${clip.length} · ${clip.tier} licence${date ? ` · ${date}` : ""}`;

  return (
    <li className="clip-row">
      {hasAudio ? (
        <span className="clip-drum">
          <Drum size={44} playing={playing} label={`${playing ? "Pause" : "Play"} ${clip.voice} clip`} onClick={onToggle} />
          <audio ref={audio} src={clip.audioUrl} preload="none" onEnded={onEnded} />
        </span>
      ) : (
        <span
          className="clip-drum off"
          title={NO_AUDIO}
          ref={(el) => el?.querySelector("button")?.setAttribute("aria-disabled", "true")}
        >
          <Drum size={44} label={`${clip.voice} clip. ${NO_AUDIO}`} />
        </span>
      )}

      <div className="clip-info">
        <span className="clip-voice">{clip.voice}</span>
        <span className="faint clip-meta">{meta}</span>
        <span className="clip-licence">
          <span className="mono faint">{clip.licenceId}</span>
          <Link href={`/verify/${encodeURIComponent(clip.licenceId)}`} aria-label={`Check licence ${clip.licenceId}`}>
            Check
          </Link>
        </span>
      </div>

      <div className="clip-download">
        {hasAudio ? (
          <a href={clip.audioUrl} download={`${clip.licenceId}.mp3`}>
            Download
          </a>
        ) : (
          <span className="faint">Download soon</span>
        )}
      </div>
    </li>
  );
}

async function endSession() {
  try {
    await supabase.auth.signOut();
  } catch {
    // Network down: supabase-js still clears the local session.
  }
}

export default function Clips() {
  const session = useSession();
  const email = session?.user?.email ?? "";
  const [state, setState] = useState<State>({ kind: "loading" });
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Live mode waits for the account; demo mode reads this browser either way.
  const authKey = API_MODE === "demo" ? "demo" : session === undefined ? "loading" : session ? session.user.id : "out";

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const clips = await listClips();
      setState({ kind: "ready", clips });
    } catch (e) {
      if (API_MODE === "live" && e instanceof ApiError && e.status === 401) {
        await endSession();
        setState({ kind: "signin" });
      } else setState({ kind: "error" });
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

  const leave = () => {
    setPlayingId(null);
    void endSession();
  };

  const view: State = authKey === "loading" ? { kind: "loading" } : authKey === "out" ? { kind: "signin" } : state;

  const stop = useCallback(() => setPlayingId(null), []);

  return (
    <Shell>
      <div className="clips">
        {API_MODE === "demo" && <p className="faint clips-demo">Demo mode: showing clips made in this browser.</p>}

        <div className="clips-head">
          <h1 className="clips-title">My clips</h1>
          <p className="muted">Clips you've made, with their licences.</p>
          {session && (
            <p className="faint clips-who">
              <span>Signed in as {email || "your account"}</span>
              <button type="button" className="clips-text-btn" onClick={leave}>
                Sign out
              </button>
            </p>
          )}
        </div>

        {view.kind === "loading" && (
          <div className="clips-status" role="status">
            <DrumRoll />
            <span className="muted">Loading your clips…</span>
          </div>
        )}

        {view.kind === "error" && (
          <div className="clips-status">
            <p role="alert" className="clips-error">
              We couldn't load your clips.
            </p>
            <button type="button" className="btn btn-outline" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}

        {view.kind === "signin" && (
          <div className="card clips-empty">
            <div className="clips-empty-body">
              <p>Sign in to see your clips.</p>
              <div className="clips-actions">
                <Link href="/signin?next=/clips" className="btn">
                  Sign in
                </Link>
                <Link href="/signup" className="btn btn-outline">
                  Create an account
                </Link>
              </div>
            </div>
          </div>
        )}

        {view.kind === "ready" && view.clips.length === 0 && (
          <div className="card clips-empty">
            <PatternStrip pattern="beads" height={12} />
            <div className="clips-empty-body">
              <p>No clips yet.</p>
              <Link href="/studio" className="btn">
                Paste your script
              </Link>
            </div>
          </div>
        )}

        {view.kind === "ready" && view.clips.length > 0 && (
          <ul className="clips-list" aria-label="Your clips">
            {view.clips.map((c) => (
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

        <p className="faint clips-foot">
          Pay-as-you-go clips stay here for 7 days. Plans keep them longer. <Link href="/pricing">See plans</Link>
        </p>
      </div>
    </Shell>
  );
}
