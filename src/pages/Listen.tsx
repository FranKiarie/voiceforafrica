import { useEffect, useRef, useState } from "react";
import { BeadProgress, Drum, Shell } from "../components/Shell";
import { Link, navigate } from "../router";
import { PREVIEW_SECONDS, VOICES, formatClock, formatDuration, formatKes, formatUsd, quoteFor } from "../data";
import { useFlow } from "../flow";
import { createPreview, type Preview } from "../lib/api";
import "./Listen.css";

const TICK_MS = 250;
const PREVIEW_KEY = "mv.preview";

function readPreview(): Preview | null {
  try {
    const raw = sessionStorage.getItem(PREVIEW_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Preview>;
    if (typeof p.previewId !== "string" || typeof p.seconds !== "number") return null;
    return { previewId: p.previewId, seconds: p.seconds, audioUrl: typeof p.audioUrl === "string" ? p.audioUrl : undefined };
  } catch {
    return null;
  }
}

function savePreview(p: Preview) {
  try {
    sessionStorage.setItem(PREVIEW_KEY, JSON.stringify({ previewId: p.previewId, seconds: p.seconds, audioUrl: p.audioUrl }));
  } catch {
    // Storage blocked: the preview lives on this page only.
  }
}

export default function Listen() {
  const flow = useFlow();
  const empty = !flow.script.trim();

  const q = quoteFor(flow.script);
  const short = q.projectedSeconds <= PREVIEW_SECONDS;
  const voice = VOICES.find((v) => v.id === flow.voiceId) ?? VOICES[0];

  const [preview, setPreview] = useState<Preview | null>(readPreview);
  const [loadError, setLoadError] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const leftForPay = useRef(false);
  const audio = useRef<HTMLAudioElement>(null);

  const audioUrl = preview?.audioUrl;
  const previewLen = preview?.seconds ?? 0;

  useEffect(() => {
    if (empty) navigate("/studio");
  }, [empty]);

  // No saved preview (new tab, storage blocked): ask for it again.
  useEffect(() => {
    if (empty || preview || loadError) return;
    let alive = true;
    createPreview({ script: flow.script, voiceId: flow.voiceId, language: flow.language, email: flow.email, purpose: flow.purpose })
      .then((p) => {
        if (!alive) return;
        savePreview(p);
        setPreview(p);
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, [empty, preview, loadError, flow.script, flow.voiceId, flow.language, flow.email, flow.purpose]);

  const goPay = () => {
    if (leftForPay.current) return;
    leftForPay.current = true;
    setPlaying(false);
    navigate("/pay");
  };

  // Real sound: the <audio> element drives play state and progress.
  useEffect(() => {
    const el = audio.current;
    if (!el || !audioUrl) return;
    if (playing) {
      el.play().catch(() => setPlaying(false)); // Autoplay blocked: wait for a tap.
    } else {
      el.pause();
    }
  }, [playing, audioUrl]);

  // Preview mode: no sound yet, so a timer stands in for it.
  useEffect(() => {
    if (!playing || empty || !preview || audioUrl) return;
    const id = window.setInterval(() => {
      setElapsed((e) => Math.min(previewLen, e + TICK_MS / 1000));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, empty, preview, audioUrl, previewLen]);

  useEffect(() => {
    if (empty || !preview || audioUrl || elapsed < previewLen) return;
    goPay();
  }, [elapsed, previewLen, empty, preview, audioUrl]);

  if (empty) return null;

  const toggle = () => setPlaying((p) => !p);

  return (
    <Shell step={2} footer={false}>
      <div className="listen">
        {preview && !audioUrl && (
          <p className="listen-pill faint">Preview mode: sound arrives when the voice service goes live.</p>
        )}

        <h1 className="listen-title">Listen to your script</h1>

        {audioUrl && (
          <audio
            ref={audio}
            src={audioUrl}
            preload="auto"
            onTimeUpdate={(e) => setElapsed(Math.min(previewLen || Infinity, e.currentTarget.currentTime))}
            onPause={() => setPlaying(false)}
            onPlay={() => setPlaying(true)}
            onEnded={goPay}
          />
        )}

        {loadError ? (
          <div className="listen-progress">
            <p role="alert">We couldn't make your preview just now.</p>
            <button type="button" className="btn" onClick={() => setLoadError(false)}>
              Try again
            </button>
          </div>
        ) : !preview ? (
          <p className="muted" role="status">
            Getting your preview…
          </p>
        ) : (
          <>
            <Drum size={140} playing={playing} label={playing ? "Pause the preview" : "Play the preview"} onClick={toggle} />

            <div className="listen-progress">
              <BeadProgress
                progress={previewLen ? elapsed / previewLen : 0}
                count={16}
                label="Preview progress"
                max={previewLen}
                now={elapsed}
              />
              <p className="faint listen-clock" aria-live="off">
                {formatClock(elapsed)} / {formatClock(previewLen)} · {voice.name}
              </p>
              {short && (
                <p className="faint listen-short">
                  Short script: you hear it all, with a soft chime. Paying unlocks the clean file.
                </p>
              )}
            </div>
          </>
        )}

        <div className="listen-buy">
          <p className="muted listen-full">Full script · about {formatDuration(q.projectedSeconds)}</p>
          <p className="listen-price">{formatUsd(q.usd)}</p>
          <button type="button" className="btn btn-block" onClick={goPay}>
            Pay {formatUsd(q.usd)}
          </button>
          <p className="faint listen-auto">{`Opens by itself when the preview ends · M-Pesa or card, charged as ${formatKes(q.kes)}`}</p>
        </div>

        <Link href="/studio" className="muted listen-again">
          Try another voice
        </Link>
      </div>
    </Shell>
  );
}
