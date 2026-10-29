import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { InkUnderline } from "../components/Motion";
import { BeadProgress, DrumRoll, PatternStrip, Shell } from "../components/Shell";
import {
  MAX_TRANSCRIBE_HOURS,
  MAX_UPLOAD_MB,
  TRANSCRIBE_ACCEPT,
  TRANSCRIBE_FORMATS,
  TRANSCRIBE_LANGUAGES,
  TRANSCRIBE_PRICE,
  formatDuration,
  formatKes,
  formatUsd,
} from "../data";
import {
  API_MODE,
  ApiError,
  confirmDemoTranscriptPayment,
  createTranscriptUpload,
  getAccount,
  getTranscript,
  isAbortError,
  mediaDuration,
  quoteTranscript,
  transcriptCheckout,
  uploadToStorage,
  type Transcript,
  type TranscriptQuote,
  type TranscriptUpload,
  type UploadProgress,
} from "../lib/api";
import { resumeWithPaystack } from "../lib/paystack";
import { useSession } from "../lib/supabase";
import { Link, navigate, usePath } from "../router";
import "./Transcribe.css";

// /transcribe: choose a file → upload → the server measures and prices it → Paystack.
// /transcribe/<id>: confirming the payment, transcribing, then the transcript.

const MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const MIN_BYTES = 1024;
const MAX_SECONDS = MAX_TRANSCRIBE_HOURS * 3600;
// The browser's reading of a file header can be a little off; only the server's measure is charged.
const LENGTH_SLACK = 120;
const EXTENSIONS = new Set(TRANSCRIBE_ACCEPT.split(",").map((e) => e.replace(/^\./, "").toLowerCase()));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NETWORK_TEXT = "Couldn't reach the server. Check your connection and try again.";
const FORMAT_LIST = "MP3, M4A, AAC, WAV, OPUS, OGG, FLAC, WEBM, AMR, AIFF, MP4 or MOV";

const POLL_MS = 4000;
const PAY_NOTE_MS = 2 * 60 * 1000;
const PAY_STOP_MS = 10 * 60 * 1000;
// The server sends at most this many characters of the transcript for the page.
const PREVIEW_CAP = 4000;

const MAIN_LANGUAGES = TRANSCRIBE_LANGUAGES.filter((l) => l.code && !l.advanced);
const ADVANCED_LANGUAGES = TRANSCRIBE_LANGUAGES.filter((l) => l.code && l.advanced);

/** "2 h 05 min", "42 min 10 s", "30 s". */
function formatLength(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 3600) return formatDuration(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

function formatSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb).toLocaleString("en-US")} MB`;
}

function extensionOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

function tooLongText(seconds: number): string {
  return `This recording is ${formatLength(seconds)} long. The limit is ${MAX_TRANSCRIBE_HOURS} hours, so trim or split it.`;
}

/** A friendly reason the file can't be used, or "" when it looks fine. */
function checkFile(file: File): string {
  const ext = extensionOf(file.name);
  if (!EXTENSIONS.has(ext)) {
    return `${ext ? `We can't read .${ext} files.` : "We can't tell what kind of file this is."} Use ${FORMAT_LIST}.`;
  }
  if (file.size < MIN_BYTES) return "That file is empty. Choose the recording itself.";
  if (file.size > MAX_BYTES) {
    return `This file is ${formatSize(file.size)}. The limit is ${MAX_UPLOAD_MB} MB, so save it as MP3 or M4A first.`;
  }
  return "";
}

/** The server's 4xx and 503 messages are written for customers; anything else gets the fallback. */
function problemText(e: unknown, fallback: string): string {
  if (e instanceof ApiError && (e.status < 500 || e.status === 503)) return e.message;
  if (e instanceof ApiError) return fallback;
  return NETWORK_TEXT;
}

function timeLeft(seconds: number): string {
  if (seconds < 60) return "less than a minute left";
  const m = Math.round(seconds / 60);
  return m === 1 ? "about a minute left" : `about ${m} minutes left`;
}

export default function Transcribe() {
  const path = usePath().replace(/\/+$/, "");
  const rest = path.startsWith("/transcribe/") ? path.slice("/transcribe/".length).split("/")[0] : "";
  let id = rest;
  try {
    id = decodeURIComponent(rest);
  } catch {
    // A malformed escape: look it up as typed and let the server say it doesn't exist.
  }
  return <Shell>{id ? <StatusView id={id} /> : <UploadView />}</Shell>;
}

// ---- upload page -----------------------------------------------------------------

type Stage =
  | { kind: "choose" }
  | { kind: "uploading" }
  | { kind: "measuring"; id: string }
  | { kind: "measure-failed"; id: string }
  | { kind: "quote"; quote: TranscriptQuote };

type PayMode = "idle" | "opening" | "open";

function UploadView() {
  const session = useSession();
  const accountEmail = session?.user?.email ?? "";
  const userId = session?.user?.id;
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  // undefined: still reading the header. null: the browser can't tell.
  const [fileSeconds, setFileSeconds] = useState<number | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [language, setLanguage] = useState("");
  const [speakers, setSpeakers] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [progress, setProgress] = useState<UploadProgress>({ loaded: 0, total: 0 });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [payMode, setPayMode] = useState<PayMode>("idle");
  const [hasPlan, setHasPlan] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const pickToken = useRef(0);
  const startedAt = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const payBtn = useRef<HTMLButtonElement>(null);
  const uploadBtn = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);

  // Signed in: start from the account email; it can still be changed.
  useEffect(() => {
    if (accountEmail) setEmail((e) => e || accountEmail);
  }, [accountEmail]);

  // Plan holders get a pointer to their included minutes (not usable on this page yet).
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    getAccount()
      .then((a) => {
        if (alive) setHasPlan(Boolean(a.plan));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [userId]);

  // A drop that misses the zone would open the file in the tab and lose the form.
  useEffect(() => {
    const stop = (e: globalThis.DragEvent) => e.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  // Leaving the page cancels an upload in flight.
  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = stage.kind === "uploading" || stage.kind === "measuring";
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  // Each new step's heading takes focus, so keyboard and screen-reader users follow along.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (stage.kind !== "choose") headingRef.current?.focus();
  }, [stage.kind]);

  const pick = useCallback((f: File) => {
    setError("");
    setNotice("");
    const problem = checkFile(f);
    const token = ++pickToken.current;
    setFile(f);
    setFileError(problem);
    setFileSeconds(problem ? null : undefined);
    if (problem) return;
    // Capped at 3 s: some phones never read the header of a file they aren't playing.
    void mediaDuration(f, 3000).then((s) => {
      if (token !== pickToken.current) return;
      setFileSeconds(s);
      if (s !== null && s > MAX_SECONDS + LENGTH_SLACK) setFileError(tooLongText(s));
    });
  }, []);

  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // Cleared so that choosing the same file again still counts as a change.
    e.target.value = "";
    if (f) pick(f);
  };

  const onDragOver = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent<HTMLLabelElement>) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setDragging(false);
  };
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) pick(f);
  };

  const focusUpload = () => requestAnimationFrame(() => uploadBtn.current?.focus());

  const backToChoose = (message: string) => {
    setStage({ kind: "choose" });
    setPayMode("idle");
    setError(message);
    focusUpload();
  };

  const measure = async (id: string) => {
    setStage({ kind: "measuring", id });
    setError("");
    try {
      const quote = await quoteTranscript(id);
      setStage({ kind: "quote", quote });
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) {
        // Something about the file itself (too long, unreadable): choose another.
        backToChoose(e.message);
      } else {
        setStage({ kind: "measure-failed", id });
        setError(problemText(e, "We couldn't check your file. Try again."));
      }
    }
  };

  const emailOk = EMAIL_RE.test(email.trim());
  const emailWrong = emailTouched && email.trim() !== "" && !emailOk;
  const reading = Boolean(file && !fileError && fileSeconds === undefined);
  const canUpload = Boolean(file && !fileError && emailOk && !reading);

  const upload = async (e: FormEvent) => {
    e.preventDefault();
    setEmailTouched(true);
    if (!file || !canUpload || stage.kind !== "choose") return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setNotice("");
    setProgress({ loaded: 0, total: file.size });
    startedAt.current = Date.now();
    setStage({ kind: "uploading" });
    try {
      let up: TranscriptUpload;
      try {
        up = await createTranscriptUpload({ fileName: file.name, size: file.size, email: email.trim(), language, speakers });
      } catch (err) {
        if (!controller.signal.aborted) backToChoose(problemText(err, "We couldn't start the upload. Try again."));
        return;
      }
      if (controller.signal.aborted) return;
      startedAt.current = Date.now();
      try {
        await uploadToStorage(up.uploadUrl, file, up.uploadHeaders ?? { "Content-Type": up.contentType }, setProgress, controller.signal);
      } catch (err) {
        if (controller.signal.aborted || isAbortError(err)) return;
        backToChoose(err instanceof Error && err.message ? err.message : NETWORK_TEXT);
        return;
      }
      await measure(up.transcriptId);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const cancelUpload = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStage({ kind: "choose" });
    setNotice("Upload cancelled. Nothing was charged.");
    focusUpload();
  };

  const startOver = () => {
    setStage({ kind: "choose" });
    setPayMode("idle");
    setError("");
    setNotice("");
    focusUpload();
  };

  const pay = async (quote: TranscriptQuote) => {
    const id = quote.transcriptId;
    const paid = () => navigate(`/transcribe/${encodeURIComponent(id)}`);
    const unpaid = (text: string) => {
      setPayMode("idle");
      setError(text);
      requestAnimationFrame(() => payBtn.current?.focus());
    };
    setPayMode("opening");
    setError("");
    try {
      // The server prices the file; the browser never sends an amount. Its figures win.
      const co = await transcriptCheckout(id);
      setStage({
        kind: "quote",
        quote: {
          transcriptId: id,
          seconds: co.seconds ?? quote.seconds,
          minutes: co.minutes ?? quote.minutes,
          amountUsd: co.amountUsd ?? quote.amountUsd,
          amountKes: co.amountKes ?? quote.amountKes,
        },
      });
      if (co.accessCode) {
        await resumeWithPaystack(co.accessCode, {
          onSuccess: paid,
          onCancel: () => unpaid("Payment not finished. Nothing was charged."),
        });
        setPayMode("open");
      } else if (API_MODE === "demo") {
        confirmDemoTranscriptPayment(id);
        paid();
      } else {
        unpaid("Nothing was charged. Payments are unavailable right now. Try again soon.");
      }
    } catch (err) {
      if (err instanceof ApiError) unpaid(`Nothing was charged. ${problemText(err, "Something went wrong on our side. Try again.")}`);
      else if (err instanceof Error && err.message === "Could not load Paystack") unpaid("Nothing was charged. Paystack didn't open. Check your connection and try again.");
      else unpaid(`Nothing was charged. ${NETWORK_TEXT}`);
    }
  };

  const chosenLanguage = TRANSCRIBE_LANGUAGES.find((l) => l.code === language);
  const languageLabel = chosenLanguage?.label ?? "Detect automatically";
  const pct = progress.total ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;
  const elapsed = (Date.now() - startedAt.current) / 1000;
  const rate = elapsed > 0 ? progress.loaded / elapsed : 0;
  const eta = elapsed > 3 && rate > 0 && pct < 100 ? timeLeft((progress.total - progress.loaded) / rate) : "";

  let announce = "";
  if (stage.kind === "uploading") announce = `Uploading, ${Math.floor(pct / 10) * 10}%`;
  else if (stage.kind === "measuring") announce = "Checking the length";
  else if (stage.kind === "quote") announce = `Price ready: ${formatUsd(stage.quote.amountUsd)}`;

  const missing = !file ? "Choose a recording first." : fileError || reading ? "" : !emailOk ? "Enter your email first." : "";

  return (
    <div className="narrow tr">
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>

      <header className="tr-head">
        <h1 className="tr-title">
          Transcribe a <InkUnderline>recording</InkUnderline>
        </h1>
        <p className="tr-lede muted">A transcript with timestamps and speaker labels.</p>
        <p className="tr-price">
          <strong>{TRANSCRIBE_PRICE}</strong>
          <span className="faint"> · every started minute · no account needed</span>
        </p>
        {hasPlan && (
          <p className="faint tr-small">
            Plan minutes (see <Link href="/pricing">Pricing</Link>) can't be used here yet, so each file is paid separately.
          </p>
        )}
      </header>

      {stage.kind === "choose" && (
        <form className="tr-form" onSubmit={(e) => void upload(e)} noValidate>
          <label
            className={`tr-drop${dragging ? " is-over" : ""}${file && !fileError ? " has-file" : ""}`}
            onDragEnter={onDragOver}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <input
              className="sr-only"
              type="file"
              accept={TRANSCRIBE_ACCEPT}
              onChange={onInput}
              aria-label={file ? `Recording: ${file.name}. Choose another file` : "Choose a recording"}
              aria-describedby="tr-file-hint"
              aria-invalid={fileError ? true : undefined}
            />
            {file ? (
              <span className="tr-file">
                <span className="tr-file-name">{file.name}</span>
                <span className="faint tr-file-meta">
                  {formatSize(file.size)}
                  {fileSeconds ? ` · ${formatLength(fileSeconds)}` : reading ? " · reading the length…" : ""}
                </span>
              </span>
            ) : (
              <span className="tr-drop-text">
                <strong>Drop a recording here</strong>
                <span className="faint">or</span>
              </span>
            )}
            <span className="btn btn-outline tr-drop-btn" aria-hidden="true">
              {file ? "Choose another file" : "Choose a file"}
            </span>
            <span id="tr-file-hint" className="faint tr-drop-hint">
              Audio or video, up to {MAX_TRANSCRIBE_HOURS} hours and {MAX_UPLOAD_MB} MB.
            </span>
          </label>
          {fileError && (
            <p className="tr-error" role="alert">
              {fileError}
            </p>
          )}
          <a
            className="tr-guide-link"
            href="#tr-guide"
            onClick={(e) => {
              e.preventDefault();
              document.getElementById("tr-guide")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            Formats and limits
          </a>

          <label className="field tr-field">
            Email for your receipt
            <input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
              aria-invalid={emailWrong || undefined}
              aria-describedby={emailWrong ? "tr-email-error" : undefined}
            />
          </label>
          {emailWrong && (
            <p id="tr-email-error" className="tr-error tr-tight">
              Check the email address.
            </p>
          )}

          <label className="field tr-field">
            Main language
            <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-describedby="tr-lang-hint">
              <option value="">Detect automatically</option>
              <optgroup label="Languages">
                {MAIN_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Read by our advanced model">
                {ADVANCED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <p id="tr-lang-hint" className="faint tr-hint">
            {chosenLanguage?.advanced ? `${languageLabel} is read by our advanced model.` : "Helps when languages are mixed."}
          </p>

          <label className="tr-check">
            <input type="checkbox" checked={speakers} onChange={(e) => setSpeakers(e.target.checked)} aria-describedby="tr-speakers-hint" />
            <span>
              Label speakers
              <span id="tr-speakers-hint" className="faint tr-check-hint">
                Set per 5-minute part, so “Speaker 1” can change on long recordings.
              </span>
            </span>
          </label>

          {error && (
            <p className="tr-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="muted tr-notice" role="status">
              {notice}
            </p>
          )}

          <div className="tr-submit">
            <button ref={uploadBtn} type="submit" className="btn btn-block" disabled={!canUpload} aria-describedby="tr-submit-note">
              {reading ? "Reading the file…" : "Upload and get a price"}
            </button>
            <p id="tr-submit-note" className="faint center tr-note">
              {missing || "You see the exact price before you pay."}
            </p>
          </div>
        </form>
      )}

      {stage.kind === "uploading" && file && (
        <section className="card tr-panel" aria-labelledby="tr-step">
          <h2 id="tr-step" ref={headingRef} tabIndex={-1} className="tr-panel-title">
            Uploading…
          </h2>
          <p className="faint tr-break">{file.name}</p>
          <BeadProgress progress={pct / 100} label="Upload progress" max={100} now={pct} />
          <p className="tr-progress-text">
            <strong>{`${pct}%`}</strong>
            <span className="faint">
              {` · ${formatSize(progress.loaded)} of ${formatSize(progress.total || file.size)}`}
              {eta ? ` · ${eta}` : ""}
            </span>
          </p>
          <p className="faint tr-note">Keep this page open.</p>
          <button type="button" className="btn btn-outline tr-cancel" onClick={cancelUpload}>
            Cancel upload
          </button>
        </section>
      )}

      {stage.kind === "measuring" && (
        <section className="card tr-panel tr-panel-center" aria-labelledby="tr-step">
          <DrumRoll size={72} />
          <h2 id="tr-step" ref={headingRef} tabIndex={-1} className="tr-panel-title">
            Checking the length…
          </h2>
          <p className="faint tr-note">This takes a few seconds.</p>
        </section>
      )}

      {stage.kind === "measure-failed" && (
        <section className="card tr-panel" aria-labelledby="tr-step">
          <h2 id="tr-step" ref={headingRef} tabIndex={-1} className="tr-panel-title">
            We couldn't check the length
          </h2>
          <p className="tr-error" role="alert">
            {error}
          </p>
          <p className="faint tr-note">Checking again won't upload your file again.</p>
          <button type="button" className="btn btn-block" onClick={() => void measure(stage.id)}>
            Check again
          </button>
          <button type="button" className="tr-text-btn" onClick={startOver}>
            Use a different file
          </button>
        </section>
      )}

      {stage.kind === "quote" && (
        <section className="card tr-panel" aria-labelledby="tr-step">
          <h2 id="tr-step" ref={headingRef} tabIndex={-1} className="tr-panel-title">
            Your price
          </h2>
          <dl className="tr-lines">
            <div>
              <dt>File</dt>
              <dd className="tr-break">{file?.name ?? "Your recording"}</dd>
            </div>
            <div>
              <dt>Length</dt>
              <dd>{formatLength(stage.quote.seconds)}</dd>
            </div>
            <div>
              <dt>Minutes billed</dt>
              <dd>{`${stage.quote.minutes.toLocaleString("en-US")} min`}</dd>
            </div>
            <div>
              <dt>Language</dt>
              <dd>{languageLabel}</dd>
            </div>
            <div>
              <dt>Speaker labels</dt>
              <dd>{speakers ? "On" : "Off"}</dd>
            </div>
            <div>
              <dt>Receipt to</dt>
              <dd className="tr-break">{email.trim()}</dd>
            </div>
          </dl>
          <div className="tr-total">
            <span>Total</span>
            <span className="tr-amount">{formatUsd(stage.quote.amountUsd)}</span>
          </div>
          <p className="faint tr-kes">{`Charged as ${formatKes(stage.quote.amountKes)} by M-Pesa or card`}</p>

          {error && (
            <p className="tr-error" role="alert">
              {error}
            </p>
          )}

          <button
            ref={payBtn}
            type="button"
            className="btn btn-block"
            onClick={() => void pay(stage.quote)}
            disabled={payMode === "opening"}
            aria-busy={payMode === "opening" || undefined}
          >
            {payMode === "opening" ? "Opening Paystack…" : `Pay ${formatUsd(stage.quote.amountUsd)}`}
          </button>
          <p className="faint center tr-note" role="status">
            {payMode === "open"
              ? "On M-Pesa? Enter your PIN on your phone. Keep this page open."
              : API_MODE === "demo"
                ? "Demo mode: no money moves and your file stays in this browser."
                : "Paystack opens when you press Pay."}
          </p>
          <button type="button" className="tr-text-btn" onClick={startOver}>
            Use a different file
          </button>
        </section>
      )}

      <Guide />
    </div>
  );
}

function Guide() {
  return (
    <section id="tr-guide" className="tr-guide" aria-labelledby="tr-guide-title">
      <h2 id="tr-guide-title" className="tr-guide-title">
        Formats and limits
      </h2>

      <div className="tr-block">
        <p>
          Up to <strong>{`${MAX_TRANSCRIBE_HOURS} hours`}</strong> and <strong>{`${MAX_UPLOAD_MB} MB`}</strong> per file.
        </p>
        <dl className="tr-rows tr-formats">
          {TRANSCRIBE_FORMATS.map((f) => (
            <div key={f.ext}>
              <dt>{f.label}</dt>
              <dd>{f.note}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">Long recording? Use MP3 or M4A: 3 hours at 128 kbps is about 170 MB.</p>
      </div>

      <div className="tr-block">
        <h3>What you get</h3>
        <ul className="tr-list">
          <li>TXT with timestamps and speaker names</li>
          <li>SRT and VTT subtitle files</li>
          <li>Download links that last 7 days</li>
          <li>Your audio deleted within 24 hours</li>
        </ul>
      </div>

      <div className="tr-block">
        <h3>Languages</h3>
        <p>{`${MAIN_LANGUAGES.map((l) => l.label).join(", ")}.`}</p>
        <p className="faint tr-small">{`Read by our advanced model: ${ADVANCED_LANGUAGES.map((l) => l.label).join(", ")}.`}</p>
      </div>
    </section>
  );
}

// ---- status page -----------------------------------------------------------------

function StatusView({ id }: { id: string }) {
  const [t, setT] = useState<Transcript | null>(null);
  const [missing, setMissing] = useState(false);
  const [trouble, setTrouble] = useState("");
  const [waitedLong, setWaitedLong] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [round, setRound] = useState(0);
  const [copyNote, setCopyNote] = useState("");
  const [downloadNote, setDownloadNote] = useState("");
  const previewRef = useRef<HTMLPreElement>(null);

  // Poll while the payment is confirmed and the file transcribed; stop at ready, failed or unmount.
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    let failures = 0;
    const started = Date.now();
    const poll = async () => {
      try {
        const next = await getTranscript(id);
        if (!alive) return;
        failures = 0;
        setTrouble("");
        setT(next);
        if (next.status === "paying") {
          const waited = Date.now() - started;
          if (next.checkoutStarted === false || waited > PAY_STOP_MS) {
            // Never paid, or an abandoned checkout: stop asking Paystack.
            // An abandoned checkout would otherwise be checked with Paystack forever.
            setStopped(true);
            return;
          }
          if (waited > PAY_NOTE_MS) setWaitedLong(true);
        } else if (next.status !== "transcribing") {
          return;
        }
      } catch (e) {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) {
          setMissing(true);
          return;
        }
        failures += 1;
        if (e instanceof ApiError && e.status === 503) setTrouble(`${e.message} Still trying…`);
        else if (failures >= 2) setTrouble("Trouble reaching the server. Still trying…");
      }
      timer = window.setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [id, round]);

  const checkAgain = () => {
    setStopped(false);
    setWaitedLong(false);
    setRound((r) => r + 1);
  };

  const copy = async (text: string) => {
    const partial = t?.previewTruncated ?? text.length >= PREVIEW_CAP - 10;
    try {
      await navigator.clipboard.writeText(text);
      setCopyNote(partial ? "Copied the part shown. Download TXT for all of it." : "Copied.");
    } catch {
      // No clipboard access: select the text so it can be copied by hand.
      const el = previewRef.current;
      const sel = window.getSelection();
      if (el && sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      setCopyNote("Text selected. Press Ctrl+C (or Cmd+C) to copy.");
    }
  };

  const status = missing ? "missing" : (t?.status ?? "loading");
  const announce: Record<string, string> = {
    paying: stopped ? "We haven't seen a payment yet" : "Confirming your payment",
    transcribing: "Transcribing",
    ready: "Your transcript is ready",
    failed: "We couldn't finish this transcript",
    missing: "We can't find that transcript",
  };

  const meta = t
    ? [t.fileName, t.seconds ? formatLength(t.seconds) : "", t.words ? `${t.words.toLocaleString("en-US")} words` : ""]
        .filter(Boolean)
        .join(" · ")
    : "";
  const link = `${window.location.host}${window.location.pathname}`;

  let body;
  if (status === "loading") {
    body = (
      <div className="tr-wait">
        <p className="muted">Loading your transcript…</p>
        {trouble && <p className="faint tr-note">{trouble}</p>}
      </div>
    );
  } else if (status === "missing") {
    body = (
      <div className="tr-wait">
        <h1 className="tr-title">We can't find that transcript</h1>
        <p className="muted">Check the link, or upload again.</p>
        <Link href="/transcribe" className="btn">
          Upload a recording
        </Link>
      </div>
    );
  } else if (status === "uploading") {
    body = (
      <div className="tr-wait">
        <h1 className="tr-title">This upload wasn't finished</h1>
        {meta && <p className="faint tr-break">{meta}</p>}
        <p className="muted">Nothing was charged. Upload it again to get a price.</p>
        <Link href="/transcribe" className="btn">
          Upload a recording
        </Link>
      </div>
    );
  } else if (status === "paying") {
    const payTitle =
      t?.checkoutStarted === false
        ? "This recording isn't paid for yet"
        : stopped
          ? "We haven't seen a payment yet"
          : "Confirming your payment…";
    body = (
      <div className="tr-wait">
        {!stopped && <DrumRoll size={80} />}
        <h1 className="tr-title">{payTitle}</h1>
        {meta && <p className="faint tr-break">{meta}</p>}
        {stopped ? (
          <>
            <p className="muted">M-Pesa can take a minute. If you didn't finish paying, nothing was charged.</p>
            <button type="button" className="btn btn-outline" onClick={checkAgain}>
              Check again
            </button>
            <Link href="/transcribe" className="tr-link">
              Upload the recording again
            </Link>
          </>
        ) : (
          <>
            <p className="muted">This usually takes a few seconds.</p>
            {waitedLong && (
              <p className="faint tr-note">
                Still waiting? If you didn't finish paying, nothing was charged. <Link href="/transcribe">Upload again</Link>.
              </p>
            )}
          </>
        )}
        {trouble && <p className="faint tr-note">{trouble}</p>}
      </div>
    );
  } else if (status === "transcribing") {
    body = (
      <div className="tr-wait">
        <DrumRoll size={80} />
        <h1 className="tr-title">Transcribing…</h1>
        {meta && <p className="faint tr-break">{meta}</p>}
        <p className="muted">About a minute for every 5 minutes of audio, so 3 hours can take up to an hour.</p>
        <p className="muted">Bookmark this link and come back later.</p>
        <p className="mono faint tr-url">{link}</p>
        {trouble && <p className="faint tr-note">{trouble}</p>}
      </div>
    );
  } else if (status === "failed") {
    body = (
      <div className="tr-wait">
        <h1 className="tr-title">We couldn't finish this transcript</h1>
        {meta && <p className="faint tr-break">{meta}</p>}
        <p className="muted">{t?.error || "Something went wrong. We'll refund you; reply to your receipt email."}</p>
        <div className="tr-links">
          <Link href="/transcribe">Upload another recording</Link>
          <a href="mailto:support@mikaka.io">Email support</a>
        </div>
      </div>
    );
  } else {
    const preview = t?.preview ?? "";
    const partial = t?.previewTruncated ?? preview.length >= PREVIEW_CAP - 10;
    const d = t?.downloads;
    const notLive = () => setDownloadNote("Downloads appear here once the service is live.");
    body = (
      <div className="tr-ready">
        <div className="tr-ready-head">
          <h1 className="tr-title">Your transcript is ready</h1>
          {meta && <p className="faint tr-break">{meta}</p>}
        </div>

        <div className="tr-downloads">
          {d ? (
            <a className="btn btn-block" href={d.txt} download>
              Download TXT
            </a>
          ) : (
            <button type="button" className="btn btn-block" onClick={notLive}>
              Download TXT
            </button>
          )}
          <div className="tr-secondary">
            {d ? (
              <>
                <a className="btn btn-outline" href={d.srt} download>
                  SRT subtitles
                </a>
                <a className="btn btn-outline" href={d.vtt} download>
                  VTT subtitles
                </a>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-outline" onClick={notLive}>
                  SRT subtitles
                </button>
                <button type="button" className="btn btn-outline" onClick={notLive}>
                  VTT subtitles
                </button>
              </>
            )}
            {preview && (
              <button type="button" className="btn btn-outline" onClick={() => void copy(preview)}>
                Copy text
              </button>
            )}
          </div>
          <p className="faint center tr-note" role="status">
            {copyNote || downloadNote}
          </p>
        </div>

        {preview ? (
          <div className="card tr-transcript">
            <PatternStrip pattern="beads" height={6} />
            <pre ref={previewRef} className="tr-preview" tabIndex={0} role="region" aria-label="Transcript">
              {preview}
            </pre>
            {partial && <p className="faint tr-partial">This is the start. Download TXT for all of it.</p>}
          </div>
        ) : (
          <p className="muted center">Download TXT to read your transcript.</p>
        )}

        <div className="tr-foot faint">
          <p>Download links last 7 days. Your audio has been deleted.</p>
          <p>
            <Link href="/transcribe">Transcribe another recording</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="narrow tr tr-status">
      <p className="sr-only" aria-live="polite">
        {announce[status] ?? ""}
      </p>
      {body}
    </div>
  );
}
