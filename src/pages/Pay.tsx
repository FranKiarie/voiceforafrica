import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DrumRoll, Shell } from "../components/Shell";
import { formatKes } from "../data";
import { setFlow, useFlow } from "../flow";
import { API_MODE, ApiError, confirmDemoPayment, createPaygCheckout, type PaygCheckout } from "../lib/api";
import { resumeWithPaystack } from "../lib/paystack";
import { Link, navigate } from "../router";
import "./Pay.css";

type Mode = "waiting" | "demo" | "cancelled" | "error";

const NETWORK_TEXT = "Nothing was charged. Check your connection and try again.";

function previewId(): string | undefined {
  try {
    const raw = sessionStorage.getItem("mv.preview");
    const id = raw ? (JSON.parse(raw) as { previewId?: unknown }).previewId : undefined;
    return typeof id === "string" ? id : undefined;
  } catch {
    return undefined;
  }
}

export default function Pay() {
  const flow = useFlow();
  const [mode, setMode] = useState<Mode>("waiting");
  const [errorText, setErrorText] = useState(NETWORK_TEXT);
  const [checkout, setCheckout] = useState<PaygCheckout | null>(null);
  const checkoutRef = useRef<PaygCheckout | null>(null);
  const started = useRef(false);

  const onSuccess = useCallback((ref: string) => {
    setFlow({ paymentRef: ref });
    navigate("/ready");
  }, []);
  const onCancel = useCallback(() => setMode("cancelled"), []);

  const start = useCallback(async () => {
    setMode("waiting");
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
      } else if (API_MODE === "demo") {
        setMode("demo");
      } else {
        setErrorText("Nothing was charged. Payments aren't available right now; please try again shortly.");
        setMode("error");
      }
    } catch (err) {
      // The server explains 4xx problems (a bad email, too many attempts) in plain words.
      if (err instanceof ApiError && err.status < 500) setErrorText(`Nothing was charged. ${err.message}`);
      else if (err instanceof ApiError) setErrorText("Nothing was charged. Something went wrong on our side; please try again.");
      else setErrorText(NETWORK_TEXT);
      setMode("error");
    }
  }, [flow.script, flow.voiceId, flow.purpose, flow.language, flow.email, onSuccess, onCancel]);

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
    if (empty) {
      navigate("/studio");
      return;
    }
    if (started.current) return;
    started.current = true;
    void start();
  }, [empty, start]);

  if (empty) return null;

  const kes = checkout?.amountKes;
  const payLabel = kes != null ? `Pay ${formatKes(kes)}` : "Try again";

  return (
    <Shell step={3} footer={false}>
      <div className="pay" aria-hidden={mode === "demo" ? true : undefined}>
        <DrumRoll />
        {mode === "cancelled" || mode === "error" ? (
          <>
            <h1 className="pay-title">{mode === "error" ? "We couldn't open the payment" : "Payment not finished"}</h1>
            <p className="muted" role={mode === "error" ? "alert" : undefined}>
              {mode === "error" ? errorText : "Nothing was charged. Your clip is still here."}
            </p>
            <button type="button" className="btn" onClick={() => void start()}>
              {payLabel}
            </button>
            <Link href="/listen" className="pay-back">
              Back to the preview
            </Link>
          </>
        ) : (
          <>
            <h1 className="pay-title">Waiting for your payment</h1>
            {kes != null && <p className="pay-amount">{formatKes(kes)}</p>}
            <p className="muted" role="status">
              On M-Pesa? Check your phone and enter your PIN. Keep this page open.
            </p>
          </>
        )}
      </div>
      {mode === "demo" && kes != null && (
        <TestCheckout email={flow.email} kes={kes} onSuccess={onDemoPaid} onCancel={onCancel} />
      )}
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
            <p className="co-note">Card payments open here once payments are live. Use M-Pesa to test.</p>
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
