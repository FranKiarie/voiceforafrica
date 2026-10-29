import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Shell } from "../components/Shell";
import { ACCENTS, PURPOSES, VOICES, formatDuration, formatKes, formatUsd, quoteFor } from "../data";
import { setFlow, useFlow } from "../flow";
import { API_MODE, ApiError, confirmDemoPayment, createPaygCheckout, type PaygCheckout } from "../lib/api";
import { resumeWithPaystack } from "../lib/paystack";
import { Link, navigate } from "../router";
import "./Pay.css";

// "open": Paystack's window is up. "demo": the test checkout stands in for it.
type Mode = "order" | "opening" | "open" | "demo";

const NETWORK_TEXT = "Nothing was charged. Check your connection and try again.";
const EXCERPT_CHARS = 160;

function previewId(): string | undefined {
  try {
    const raw = sessionStorage.getItem("mv.preview");
    const id = raw ? (JSON.parse(raw) as { previewId?: unknown }).previewId : undefined;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Step 3: the order and a Pay button. Paystack opens only when Pay is pressed. */
export default function Pay() {
  const flow = useFlow();
  const [mode, setMode] = useState<Mode>("order");
  const [message, setMessage] = useState("");
  const [checkout, setCheckout] = useState<PaygCheckout | null>(null);
  const checkoutRef = useRef<PaygCheckout | null>(null);
  const payBtn = useRef<HTMLButtonElement>(null);

  const onSuccess = useCallback((ref: string) => {
    setFlow({ paymentRef: ref });
    navigate("/ready");
  }, []);

  const backToOrder = useCallback((text: string) => {
    setMode("order");
    setMessage(text);
    requestAnimationFrame(() => payBtn.current?.focus());
  }, []);
  const onCancel = useCallback(() => backToOrder("Payment not finished. Nothing was charged."), [backToOrder]);

  const pay = useCallback(async () => {
    setMode("opening");
    setMessage("");
    try {
      // The server prices the job; the browser never sends an amount.
      let co = checkoutRef.current;
      if (!co) {
        co = await createPaygCheckout({
          previewId: previewId(),
          script: flow.script,
          voiceId: flow.voiceId,
          purpose: flow.purpose,
          language: flow.language,
          email: flow.email,
        });
        checkoutRef.current = co;
        setCheckout(co);
        setFlow({ jobId: co.jobId, paidKes: co.amountKes });
      }
      if (co.accessCode) {
        await resumeWithPaystack(co.accessCode, { onSuccess, onCancel });
        setMode("open");
      } else if (API_MODE === "demo") {
        setMode("demo");
      } else {
        backToOrder("Nothing was charged. Payments aren't available right now. Try again soon.");
      }
    } catch (err) {
      // The server explains 4xx problems (a bad email, too many attempts) in plain words.
      if (err instanceof ApiError && err.status < 500) backToOrder(`Nothing was charged. ${err.message}`);
      else if (err instanceof ApiError) backToOrder("Nothing was charged. Something went wrong on our side. Try again.");
      else backToOrder(NETWORK_TEXT);
    }
  }, [flow.script, flow.voiceId, flow.purpose, flow.language, flow.email, onSuccess, onCancel, backToOrder]);

  const onDemoPaid = useCallback(
    (ref: string) => {
      const co = checkoutRef.current;
      if (co) confirmDemoPayment(co.jobId);
      onSuccess(ref);
    },
    [onSuccess],
  );

  const empty = !flow.script.trim();

  useEffect(() => {
    if (empty) navigate("/studio");
  }, [empty]);

  if (empty) return null;

  const q = quoteFor(flow.script);
  // The server prices the script with the same formula; once it answers, its figures win.
  const usd = checkout?.amountUsd ?? q.usd;
  const kes = checkout?.amountKes ?? q.kes;
  const voice = VOICES.find((v) => v.id === flow.voiceId) ?? VOICES[0];
  const accent = ACCENTS.find((a) => a.id === voice.accent)?.label;
  const purpose = PURPOSES.find((p) => p.id === flow.purpose)?.label ?? "Voice-over";
  const script = flow.script.trim();
  const excerpt = script.length > EXCERPT_CHARS ? `${script.slice(0, EXCERPT_CHARS).trimEnd()}…` : script;

  return (
    <Shell step={3} footer={false}>
      <div className="pay" aria-hidden={mode === "demo" ? true : undefined}>
        <h1 className="pay-title">Your order</h1>

        <section className="card pay-order" aria-label="Order summary">
          <dl className="pay-lines">
            <div>
              <dt>Voice</dt>
              <dd>{accent ? `${voice.name} · ${accent}` : voice.name}</dd>
            </div>
            <div>
              <dt>For</dt>
              <dd>{purpose}</dd>
            </div>
            <div>
              <dt>Length</dt>
              <dd>{`About ${formatDuration(q.projectedSeconds)}`}</dd>
            </div>
            {flow.email && (
              <div>
                <dt>Receipt to</dt>
                <dd className="pay-email">{flow.email}</dd>
              </div>
            )}
          </dl>
          <blockquote className="pay-script">{excerpt}</blockquote>
          <div className="pay-total">
            <span>Total</span>
            <span className="pay-amount">{formatUsd(usd)}</span>
          </div>
          <p className="faint pay-kes">{`Billed as ${formatDuration(q.billedSeconds)} · ${formatKes(kes)} by M-Pesa or card`}</p>
        </section>

        <p className="pay-error" role="alert">
          {message}
        </p>

        <button ref={payBtn} type="button" className="btn btn-block pay-btn" onClick={() => void pay()} disabled={mode === "opening"}>
          {mode === "opening" ? "Opening Paystack…" : `Pay ${formatUsd(usd)}`}
        </button>
        <p className="faint pay-note" role="status">
          {mode === "open" ? "On M-Pesa, enter your PIN on your phone and keep this page open." : ""}
        </p>

        <div className="pay-links">
          <Link href="/listen">Back to preview</Link>
          <Link href="/studio">Change script or voice</Link>
        </div>
      </div>
      {mode === "demo" && <TestCheckout email={flow.email} kes={kes} onSuccess={onDemoPaid} onCancel={onCancel} />}
    </Shell>
  );
}

/** Stand-in for Paystack's screen when no public key is set. No money moves. */
function TestCheckout({
  email,
  kes,
  onSuccess,
  onCancel,
}: {
  email: string;
  kes: number;
  onSuccess(ref: string): void;
  onCancel(): void;
}) {
  const [tab, setTab] = useState<"mpesa" | "card">("mpesa");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    first.current?.focus();
    return () => window.clearTimeout(timer.current);
  }, []);

  const simulate = () => {
    setBusy(true);
    timer.current = window.setTimeout(() => onSuccess(`DEMO-${Date.now()}`), 1200);
  };

  const cancel = () => {
    window.clearTimeout(timer.current);
    onCancel();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = panel.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
    if (!items.length) return;
    const a = items[0];
    const z = items[items.length - 1];
    if (e.shiftKey && document.activeElement === a) {
      e.preventDefault();
      z.focus();
    } else if (!e.shiftKey && document.activeElement === z) {
      e.preventDefault();
      a.focus();
    }
  };

  return (
    <div className="co-layer" onKeyDown={onKeyDown}>
      <div className="co-backdrop" aria-hidden="true" onClick={cancel} />
      <div ref={panel} className="co-panel" role="dialog" aria-modal="true" aria-labelledby="co-title">
        <div className="co-head">
          <div className="co-who">
            <span className="co-email">{email || "No email given"}</span>
            <span id="co-title" className="co-amount">
              Pay <strong>{formatKes(kes)}</strong>
            </span>
          </div>
          <span className="co-tag">TEST CHECKOUT · NO MONEY MOVES</span>
        </div>
        <div className="co-body">
          <div className="co-tabs" role="group" aria-label="Payment method">
            <button
              ref={first}
              type="button"
              className="co-tab"
              aria-pressed={tab === "mpesa"}
              onClick={() => setTab("mpesa")}
            >
              M-Pesa
            </button>
            <button type="button" className="co-tab" aria-pressed={tab === "card"} onClick={() => setTab("card")}>
              Card
            </button>
          </div>
          {tab === "mpesa" ? (
            <label className="co-field">
              M-Pesa phone number
              <input
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="07XX XXX XXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={busy}
              />
            </label>
          ) : (
            <p className="co-note">Card opens once payments are live; test with M-Pesa.</p>
          )}
          <button type="button" className="co-pay" onClick={simulate} disabled={busy || tab !== "mpesa"}>
            {busy ? "Waiting for M-Pesa…" : "Simulate M-Pesa payment"}
          </button>
          <span className="co-live" role="status">
            {busy ? "Waiting for M-Pesa" : ""}
          </span>
          <button type="button" className="co-cancel" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
