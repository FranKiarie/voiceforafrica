import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DrumRoll, Shell } from "../components/Shell";
import { formatKes, quoteFor } from "../data";
import { setFlow, useFlow } from "../flow";
import { payWithPaystack } from "../lib/paystack";
import { Link, navigate } from "../router";
import "./Pay.css";

type Mode = "waiting" | "demo" | "cancelled";

export default function Pay() {
  const flow = useFlow();
  const q = quoteFor(flow.script);
  const [mode, setMode] = useState<Mode>("waiting");
  const started = useRef(false);

  const onSuccess = useCallback(
    (ref: string) => {
      setFlow({ paymentRef: ref, paidKes: q.kes });
      navigate("/ready");
    },
    [q.kes],
  );
  const onCancel = useCallback(() => setMode("cancelled"), []);

  const start = useCallback(async () => {
    setMode("waiting");
    try {
      const result = await payWithPaystack({
        email: flow.email,
        amountKes: q.kes,
        metadata: { purpose: "payg_job", voice: flow.voiceId, chars: q.chars },
        onSuccess,
        onCancel,
      });
      if (result === "demo") setMode("demo");
    } catch {
      setMode("cancelled");
    }
  }, [flow.email, flow.voiceId, q.kes, q.chars, onSuccess, onCancel]);

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

  return (
    <Shell step={3} footer={false}>
      <div className="pay" aria-hidden={mode === "demo" ? true : undefined}>
        <DrumRoll />
        {mode === "cancelled" ? (
          <>
            <h1 className="pay-title">Payment not finished</h1>
            <p className="muted">Nothing was charged. Your clip is still here.</p>
            <button type="button" className="btn" onClick={() => void start()}>
              {`Pay ${formatKes(q.kes)}`}
            </button>
            <Link href="/listen" className="pay-back">
              Back to the preview
            </Link>
          </>
        ) : (
          <>
            <h1 className="pay-title">Waiting for your payment</h1>
            <p className="muted" role="status">
              On M-Pesa? Check your phone and enter your PIN. Keep this page open.
            </p>
          </>
        )}
      </div>
      {mode === "demo" && (
        <TestCheckout email={flow.email} kes={q.kes} onSuccess={onSuccess} onCancel={onCancel} />
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
