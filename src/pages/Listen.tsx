import { useEffect, useRef, useState } from "react";
import { BeadProgress, Drum, Shell } from "../components/Shell";
import { Link, navigate } from "../router";
import { PREVIEW_SECONDS, VOICES, formatClock, formatDuration, formatKes, quoteFor } from "../data";
import { useFlow } from "../flow";
import "./Listen.css";

const TICK_MS = 250;

export default function Listen() {
  const flow = useFlow();
  const empty = !flow.script.trim();

  const q = quoteFor(flow.script);
  const short = q.projectedSeconds <= PREVIEW_SECONDS;
  // Long scripts run on to the end of the next sentence, about 47 s.
  const previewLen = short ? Math.max(5, q.projectedSeconds) : PREVIEW_SECONDS + 2;
  const voice = VOICES.find((v) => v.id === flow.voiceId) ?? VOICES[0];

  const [playing, setPlaying] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const leftForPay = useRef(false);

  useEffect(() => {
    if (empty) navigate("/studio");
  }, [empty]);

  useEffect(() => {
    if (!playing || empty) return;
    const id = window.setInterval(() => {
      setElapsed((e) => Math.min(previewLen, e + TICK_MS / 1000));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, empty, previewLen]);

  useEffect(() => {
    if (empty || elapsed < previewLen || leftForPay.current) return;
    leftForPay.current = true;
    setPlaying(false);
    navigate("/pay");
  }, [elapsed, previewLen, empty]);

  if (empty) return null;

  const toggle = () => setPlaying((p) => !p);

  return (
    <Shell step={2} footer={false}>
      <div className="listen">
        <p className="listen-pill faint">Preview mode: sound arrives when the voice service goes live.</p>

        <h1 className="listen-title">Listen to your script</h1>

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

        <div className="listen-buy">
          <p className="muted listen-full">Full script · about {formatDuration(q.projectedSeconds)}</p>
          <p className="listen-price">{formatKes(q.kes)}</p>
          <button type="button" className="btn btn-block" onClick={() => navigate("/pay")}>
            Pay {formatKes(q.kes)}
          </button>
          <p className="faint listen-auto">Opens by itself when the preview ends · M-Pesa or card</p>
        </div>

        <Link href="/studio" className="muted listen-again">
          Try another voice
        </Link>
      </div>
    </Shell>
  );
}
