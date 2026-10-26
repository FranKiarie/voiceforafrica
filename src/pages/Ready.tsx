import { useEffect, useMemo, useRef, useState } from "react";
import { DrumRoll, Drum, PatternStrip, Shell } from "../components/Shell";
import { VOICES, formatClock, quoteFor } from "../data";
import { objectUrl, saveFromUrl, saveText } from "../download";
import { setFlow, useFlow } from "../flow";
import { licenceDocument } from "../licence";
import { ApiError, getJob, type Job } from "../lib/api";
import { Link, navigate } from "../router";
import "./Ready.css";

const POLL_MS = 2000;

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
  const canClaim = Boolean(jobId && flow.script.trim());

  useEffect(() => {
    if (!flow.script.trim()) {
      navigate("/studio");
      return;
    }
    if (!jobId) {
      navigate("/listen");
      return;
    }
    let alive = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const j = await getJob(jobId, { script: flow.script, voiceId: flow.voiceId, language: flow.language });
        if (!alive) return;
        setJob(j);
        if (j.status === "ready") {
          if (j.licenceId) setFlow({ licenceId: j.licenceId });
          return;
        }
        if (j.status === "failed") return;
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && (e.status === 404 || e.status === 400)) {
          setJob({ jobId, status: "failed", error: e.message });
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
  }, [canClaim, jobId, flow.script, flow.voiceId, flow.language]);

  const rawAudio = job?.status === "ready" ? job.audioUrl : undefined;
  const audioUrl = useMemo(() => (rawAudio ? objectUrl(rawAudio) : undefined), [rawAudio]);
  useEffect(() => {
    if (!audioUrl?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    if (playing) el.play().catch(() => setPlaying(false));
    else el.pause();
  }, [playing, audioUrl]);

  if (!canClaim || !jobId) return null;

  if (!job || job.status === "paying" || job.status === "generating") {
    const confirming = !job || job.status === "paying";
    return (
      <Shell step={4} footer={false}>
        <div className="ready">
          <DrumRoll />
          <div role="status">
            <h1 className="ready-title">{confirming ? "Confirming your payment…" : "Making your full clip…"}</h1>
            {confirming && <p className="muted">If you used M-Pesa, enter the PIN on your phone and keep this page open.</p>}
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
            {job.error || "Something went wrong making your clip. Email support@mikaka.io with your payment reference."}
          </p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setFlow({ jobId: undefined, paymentRef: undefined, accessCode: undefined, licenceId: undefined });
              navigate("/pay?retry=1");
            }}
          >
            Try payment again
          </button>
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
            playsInline
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
            <button
              type="button"
              className="btn btn-block"
              onClick={() => {
                const ext = job.mime === "audio/wav" ? "wav" : "mp3";
                void saveFromUrl(`mikaka-voice.${ext}`, audioUrl).catch(() =>
                  setMp3Note("The download didn't start. Tap play, then try again."),
                );
              }}
            >
              Download {job.mime === "audio/wav" ? "WAV" : "MP3"}
            </button>
          ) : (
            <button type="button" className="btn btn-block" onClick={() => setMp3Note("The file isn't ready yet.")}>
              Download audio
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
                href="#licence"
                onClick={(e) => {
                  e.preventDefault();
                  if (!id) return;
                  const issued = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
                  void saveText(
                    `mikaka-licence-${id}.txt`,
                    licenceDocument({
                      id,
                      voice: voiceName,
                      language: flow.language,
                      seconds,
                      paidKes: flow.paidKes,
                      email: flow.email,
                      issued,
                    }),
                  ).catch(() => setPdfNote("The licence file didn't download. Copy the ID above."));
                }}
              >
                Licence (text file)
              </a>
              {id && <Link href={`/verify/${id}`}>Check it</Link>}
            </div>
          </div>
          <p className="ready-note ready-licence-note muted" role="status">
            {pdfNote}
          </p>
        </section>

        <div className="ready-foot faint">
          <p>Save the file and the licence ID before you leave this page. We don't email a copy.</p>
          <p>
            Making more than 10 minutes a month? <Link href="/pricing">See pricing</Link>
          </p>
        </div>
      </div>
    </Shell>
  );
}
