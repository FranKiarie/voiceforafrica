import { useEffect, useRef, useState } from "react";
import { Drum, PatternStrip, Shell } from "../components/Shell";
import { VOICES, formatClock, formatDuration, quoteFor } from "../data";
import { getFlow, setFlow, useFlow } from "../flow";
import { Link, navigate } from "../router";
import "./Ready.css";

const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LICENCES_KEY = "mv.licences";
const NOT_LIVE = "Your MP3 downloads here once the voice service is live.";

type Licence = { id: string; tier: string; voice: string; length: string; issued: string; paidKes?: number };

function newLicenceId(): string {
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += ID_CHARS[b % ID_CHARS.length];
  return `VS-${new Date().getFullYear()}-${s}`;
}

function saveLicence(lic: Licence) {
  try {
    const raw = localStorage.getItem(LICENCES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const list: Licence[] = Array.isArray(parsed) ? parsed : [];
    if (list.some((l) => l && l.id === lic.id)) return;
    list.push(lic);
    localStorage.setItem(LICENCES_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: the licence still shows on this page.
  }
}

export default function Ready() {
  const flow = useFlow();
  const q = quoteFor(flow.script);
  const voiceName = VOICES.find((v) => v.id === flow.voiceId)?.name ?? flow.voiceId;
  const [playing, setPlaying] = useState(false);
  const [mp3Note, setMp3Note] = useState("");
  const [pdfNote, setPdfNote] = useState("");
  const made = useRef(false);
  const paid = Boolean(flow.paymentRef);

  useEffect(() => {
    if (!paid) {
      navigate("/listen");
      return;
    }
    if (made.current) return;
    made.current = true;
    const current = getFlow();
    if (current.licenceId) return;
    const id = newLicenceId();
    setFlow({ licenceId: id });
    saveLicence({
      id,
      tier: "Commercial",
      voice: voiceName,
      length: formatDuration(q.projectedSeconds),
      issued: new Date().toISOString().slice(0, 10),
      paidKes: current.paidKes,
    });
  }, [paid, voiceName, q.projectedSeconds]);

  if (!paid) return null;
  const id = flow.licenceId ?? "";

  return (
    <Shell step={4} footer={false}>
      <div className="ready">
        <svg className="stamp" width="56" height="56" viewBox="0 0 40 40" aria-hidden="true">
          <path d="M20 2 L24 14 L36 10 L28 20 L36 30 L24 26 L20 38 L16 26 L4 30 L12 20 L4 10 L16 14 Z" fill="#E8A33C" />
          <circle cx="20" cy="20" r="6" fill="#2E9E6B" />
        </svg>

        <div className="ready-head">
          <h1 className="ready-title">Your clip is ready</h1>
          <p className="faint">{`${formatClock(q.projectedSeconds)} · ${voiceName}`}</p>
        </div>

        <Drum
          size={96}
          playing={playing}
          label={playing ? "Pause your clip" : "Play your clip"}
          onClick={() => setPlaying((p) => !p)}
        />

        <div className="ready-download">
          <button type="button" className="btn btn-block" onClick={() => setMp3Note(NOT_LIVE)}>
            Download MP3
          </button>
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
          <p>We emailed you a link to come back to this clip for 7 days.</p>
          <p>
            Making more than 10 minutes a month? <Link href="/pricing">Plans from $15</Link>
          </p>
        </div>
      </div>
    </Shell>
  );
}
