import { useEffect, useRef, useState } from "react";
import { DrumRoll, Drum, PatternStrip, Shell } from "../components/Shell";
import { VOICES, formatClock, quoteFor } from "../data";
import { setFlow, useFlow } from "../flow";
import { ApiError, getJob, type Job } from "../lib/api";
import { Link, navigate } from "../router";
import "./Ready.css";

const POLL_MS = 2000;
const NOT_LIVE = "Your MP3 downloads here once the voice service is live.";

export default function Ready() {
  const flow = useFlow();
  const q = quoteFor(flow.script);
  const voiceName = VOICES.find((v) => v.id === flow.voiceId)?.name ?? flow.voiceId;
  const [job, setJob] = useState<Job | null>(null);
  const [playing, setPlaying] = useState(false);
  const [mp3Note, setMp3Note] = useState("");
  const [pdfNote, setPdfNote] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const jobId = flow.jobId;
  const paid = Boolean(jobId && flow.paymentRef);

  useEffect(() => {
    if (!paid || !jobId) {
      navigate("/listen");
      return;
    }
    let alive = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const j = await getJob(jobId);
        if (!alive) return;
        setJob(j);
        if (j.status === "ready") {
          if (j.licenceId) setFlow({ licenceId: j.licenceId });
          return;
        }
        if (j.status === "failed") return;
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) {
          setJob({ jobId, status: "failed" });
          return;
        }
        // Network hiccup: keep trying.
      }
      timer = window.setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [paid, jobId]);

  const audioUrl = job?.status === "ready" ? job.audioUrl : undefined;

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    if (playing) el.play().catch(() => setPlaying(false));
    else el.pause();
  }, [playing, audioUrl]);

  if (!paid) return null;

  if (!job || job.status === "paying" || job.status === "generating") {
    return (
      <Shell step={4} footer={false}>
        <div className="ready">
          <DrumRoll />
          <div role="status">
            <h1 className="ready-title">Making your full clip…</h1>
          </div>
        </div>
      </Shell>
    );
  }

  if (job.status === "failed") {
    return (
      <Shell step={4} footer={false}>
        <div className="ready">
          <h1 className="ready-title">Something went wrong</h1>
          <p className="muted" role="alert">
            Something went wrong making your clip. We'll refund you automatically.
          </p>
          <Link href="/studio">Back to the studio</Link>
        </div>
      </Shell>
    );
  }

  const id = job.licenceId ?? flow.licenceId ?? "";
  const seconds = job.seconds ?? q.projectedSeconds;

  return (
    <Shell step={4} footer={false}>
      <div className="ready">
        <svg className="stamp" width="56" height="56" viewBox="0 0 40 40" aria-hidden="true">
          <path d="M20 2 L24 14 L36 10 L28 20 L36 30 L24 26 L20 38 L16 26 L4 30 L12 20 L4 10 L16 14 Z" fill="#E8A33C" />
          <circle cx="20" cy="20" r="6" fill="#2E9E6B" />
        </svg>

        <div className="ready-head">
          <h1 className="ready-title">Your clip is ready</h1>
          <p className="faint">{`${formatClock(seconds)} · ${voiceName}`}</p>
        </div>

        {audioUrl && (
          <audio
            ref={audio}
            src={audioUrl}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        )}

        <Drum
          size={96}
          playing={playing}
          label={playing ? "Pause your clip" : "Play your clip"}
          onClick={() => setPlaying((p) => !p)}
        />

        <div className="ready-download">
          {audioUrl ? (
            <a className="btn btn-block" href={audioUrl} download>
              Download MP3
            </a>
          ) : (
            <button type="button" className="btn btn-block" onClick={() => setMp3Note(NOT_LIVE)}>
              Download MP3
            </button>
          )}
          <p className="ready-note muted" role="status">
            {mp3Note}
          </p>
        </div>

        <section className="card ready-licence" aria-label="Licence">
          <PatternStrip pattern="kente" height={6} />
          <div className="ready-licence-body">
            <div className="ready-licence-id">
              <span className="ready-licence-name">Commercial licence</span>
              <span className="mono faint">{id}</span>
            </div>
            <div className="ready-licence-links">
              <a
                href="#certificate"
                onClick={(e) => {
                  e.preventDefault();
                  setPdfNote("Your certificate downloads here once the voice service is live.");
                }}
              >
                Certificate (PDF)
              </a>
              {id && <Link href={`/verify/${id}`}>Check it</Link>}
            </div>
          </div>
          <p className="ready-note ready-licence-note muted" role="status">
            {pdfNote}
          </p>
        </section>

        <div className="ready-foot faint">
          <p>Sign in with this email to find this clip in My clips for 7 days.</p>
          <p>
            Making more than 8 minutes a month? <Link href="/pricing">Plans from $15</Link>
          </p>
        </div>
      </div>
    </Shell>
  );
}
