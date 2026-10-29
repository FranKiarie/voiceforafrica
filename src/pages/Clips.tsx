import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AppShell } from "../components/AppShell";
import { BeadWave } from "../components/Motion";
import { Drum, DrumRoll, PatternStrip, Shell } from "../components/Shell";
import { API_MODE, ApiError, jobDownloadUrl, listClips, type AudioVersion, type Clip } from "../lib/api";
import { supabase, useSession } from "../lib/supabase";
import { Link } from "../router";
import "./Clips.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const NO_AUDIO = "Audio comes once the voice service is live";
const PHONE_NOTE = "8 kHz is for phone menus and on-hold (IVR).";
const VERSION_NOT_LIVE = "Downloads once the voice service is live.";

/** The chevron on an "Other versions" toggle; it turns over when the list is open. */
export function VersionsChevron() {
  return (
    <svg className="versions-chev" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9 L12 15 L18 9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Every audio version of a ready clip. Allowed ones are download links; locked ones
 * say which plan unlocks them and link to the pricing page, never to the file.
 */
export function VersionList({
  jobId,
  versions,
  id,
  hidden,
  className,
}: {
  jobId: string;
  versions: AudioVersion[];
  id?: string;
  hidden?: boolean;
  className?: string;
}) {
  const [note, setNote] = useState("");
  const hasPhone = versions.some((v) => v.id.startsWith("ivr"));

  return (
    <div id={id} hidden={hidden} className={className ? `versions ${className}` : "versions"}>
      <ul className="versions-list">
        {versions.map((v) => {
          if (!v.allowed) {
            return (
              <li key={v.id} className="versions-item versions-locked">
                <span className="versions-label">{v.label}</span>
                <Link href="/pricing" className="versions-unlock">
                  {v.needs ? `On ${v.needs} and up` : "On a paid plan"}
                  <span className="sr-only">{`, see plans for ${v.label}`}</span>
                </Link>
              </li>
            );
          }
          const url = jobDownloadUrl(jobId, v.id);
          return (
            <li key={v.id} className="versions-item">
              {url ? (
                <a className="versions-get" href={url} download>
                  <span className="versions-label">{v.label}</span>
                  <DownloadGlyph />
                </a>
              ) : (
                <button type="button" className="versions-get" onClick={() => setNote(VERSION_NOT_LIVE)}>
                  <span className="versions-label">{v.label}</span>
                  <DownloadGlyph />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {hasPhone && <p className="versions-note faint">{PHONE_NOTE}</p>}
      <p className="versions-note muted" role="status">
        {note}
      </p>
    </div>
  );
}

function DownloadGlyph() {
  return (
    <svg className="versions-glyph" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4 V15 M7 10.5 L12 15.5 L17 10.5 M5 20 H19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

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

/** A list of clip rows. */
export function ClipList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul className="clips-list" aria-label={label}>
      {children}
    </ul>
  );
}

export function ClipRow({
  clip,
  playing,
  onToggle,
  onEnded,
}: {
  clip: Clip;
  playing: boolean;
  onToggle: () => void;
  onEnded: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const hasAudio = Boolean(clip.audioUrl);
  const versions = clip.versions?.length ? clip.versions : null;
  const [versionsOpen, setVersionsOpen] = useState(false);
  const versionsId = useId();

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    if (playing) el.play().catch(onEnded);
    else el.pause();
  }, [playing, onEnded]);

  const date = formatDate(clip.createdAt);
  const meta = `${clip.length} · ${clip.tier} licence${date ? ` · ${date}` : ""}`;

  return (
    <li className={`clip-row${playing ? " is-playing" : ""}`}>
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
        <div className="clip-voice-row">
          <span className="clip-voice">{clip.voice}</span>
          {playing && <BeadWave beads={9} speaking className="clip-wave" />}
        </div>
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
        {versions && (
          <button
            type="button"
            className="versions-toggle"
            aria-expanded={versionsOpen}
            aria-controls={versionsId}
            onClick={() => setVersionsOpen((o) => !o)}
          >
            Other versions
            <span className="sr-only">{` of ${clip.voice} clip ${clip.licenceId}`}</span>
            <VersionsChevron />
          </button>
        )}
      </div>

      {versions && <VersionList id={versionsId} hidden={!versionsOpen} className="clip-versions" jobId={clip.id} versions={versions} />}
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
  // Shell already gives signed-in visitors the sidebar; the demo has no session, so it asks for it.
  const Frame = API_MODE === "demo" ? AppShell : Shell;
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

  const view: State = authKey === "loading" ? { kind: "loading" } : authKey === "out" ? { kind: "signin" } : state;

  const stop = useCallback(() => setPlayingId(null), []);

  return (
    <Frame>
      <div className="clips">
        {API_MODE === "demo" && <p className="faint clips-demo">Demo: clips made in this browser.</p>}

        <h1 className="clips-title">My clips</h1>

        {view.kind === "loading" && (
          <div className="clips-status" role="status">
            <DrumRoll />
            <span className="muted">Loading clips…</span>
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
          <ClipList label="Your clips">
            {view.clips.map((c) => (
              <ClipRow
                key={c.id}
                clip={c}
                playing={playingId === c.id}
                onToggle={() => setPlayingId((p) => (p === c.id ? null : c.id))}
                onEnded={stop}
              />
            ))}
          </ClipList>
        )}

        <p className="faint clips-foot">
          Pay-as-you-go clips stay 7 days; plans keep them longer. <Link href="/pricing">See plans</Link>
        </p>
      </div>
    </Frame>
  );
}
