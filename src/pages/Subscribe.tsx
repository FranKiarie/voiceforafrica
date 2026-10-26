import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { DrumRoll, PatternStrip, Shell } from "../components/Shell";
import { formatKes, KES_PER_USD, type PatternId } from "../data";
import { getFlow } from "../flow";
import { API_MODE, confirmPlanCheckout, createPlanCheckout, PLAN_PRICES_USD, type Billing, type Plan } from "../lib/api";
import { Link } from "../router";
import "./Pay.css";
import "./Subscribe.css";

type PlanInfo = { name: string; pattern: PatternId; perks: string[] };

const PLANS: Record<Plan, PlanInfo> = {
  starter: {
    name: "Starter",
    pattern: "beads",
    perks: ["200 minutes a month", "2 languages", "WAV files", "Commercial licence"],
  },
  creator: {
    name: "Creator",
    pattern: "kitenge",
    perks: ["750 minutes a month", "5 languages", "Style control", "Two-voice dialogue"],
  },
  pro: {
    name: "Pro",
    pattern: "adire",
    perks: ["1,600 minutes a month", "Every language", "Broadcast licence", "3 seats"],
  },
  business: {
    name: "Business",
    pattern: "kente",
    perks: ["6,000 minutes a month", "Resale licence", "10 seats"],
  },
};

type Method = "card" | "mpesa";
type Phase = "form" | "busy" | "demo" | "confirming" | "pending" | "done";

const POLL_EVERY_MS = 2000;
const POLL_FOR_MS = 30000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isPlan(p: string): p is Plan {
  return Object.prototype.hasOwnProperty.call(PLANS, p);
}

function readQuery(): { plan: string; billing: Billing } {
  const q = new URLSearchParams(window.location.search);
  return { plan: q.get("plan") || "creator", billing: q.get("billing") === "yearly" ? "yearly" : "monthly" };
}

/** Same rounding the checkout uses: nearest KES 5 up. The server's figure wins once it answers. */
function estimateKes(usd: number): number {
  return Math.ceil((usd * KES_PER_USD) / 5) * 5;
}

// Paystack Inline, loaded only when the server hands us an access code.
const INLINE_SRC = "https://js.paystack.co/v2/inline.js";
let inlineLoading: Promise<void> | null = null;

type PaystackCallbacks = { onSuccess(t: { reference: string }): void; onCancel(): void };
type PaystackPopCtor = new () => { resumeTransaction(accessCode: string, callbacks: PaystackCallbacks): void };

function paystackPop(): PaystackPopCtor | undefined {
  return (window as unknown as { PaystackPop?: PaystackPopCtor }).PaystackPop;
}

function loadInline(): Promise<void> {
  if (paystackPop()) return Promise.resolve();
  if (inlineLoading) return inlineLoading;
  inlineLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = INLINE_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      inlineLoading = null;
      s.remove();
      reject(new Error("Could not load Paystack"));
    };
    document.head.appendChild(s);
  });
  return inlineLoading;
}

export default function Subscribe() {
  const initial = useRef(readQuery()).current;
  const [billing, setBilling] = useState<Billing>(initial.billing);
  const [email, setEmail] = useState(() => getFlow().email);
  const [method, setMethod] = useState<Method>("card");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState("");
  const [chargeKes, setChargeKes] = useState<number | null>(null);
  const payBtn = useRef<HTMLButtonElement>(null);
  const checkoutId = useRef("");
  const pollRun = useRef(0);

  // Leaving the page stops any confirmation poll still running.
  useEffect(
    () => () => {
      pollRun.current++;
    },
    [],
  );

  if (!isPlan(initial.plan)) {
    return (
      <Shell>
        <div className="narrow center sub-missing">
          <h1>We don't have that plan</h1>
          <p className="muted">Pick Starter, Creator, Pro or Business on the pricing page.</p>
          <Link href="/pricing" className="btn btn-outline">
            See all plans
          </Link>
        </div>
      </Shell>
    );
  }

  const plan: Plan = initial.plan;
  const info = PLANS[plan];

  if (phase === "done") return <Done name={info.name} />;

  const monthlyUsd = PLAN_PRICES_USD[plan];
  const usd = billing === "yearly" ? monthlyUsd * 10 : monthlyUsd;
  const kes = estimateKes(usd);

  const pickBilling = (b: Billing) => {
    setBilling(b);
    setChargeKes(null);
    window.history.replaceState(window.history.state, "", `/subscribe?plan=${plan}&billing=${b}`);
  };

  const backToForm = (message: string) => {
    setPhase("form");
    setError(message);
    requestAnimationFrame(() => payBtn.current?.focus());
  };

  /** Paystack said yes; ask our server to verify it, every 2 s for up to 30 s. */
  const confirmPayment = async () => {
    const run = ++pollRun.current;
    const id = checkoutId.current;
    setPhase("confirming");
    const deadline = Date.now() + POLL_FOR_MS;
    for (;;) {
      try {
        const r = await confirmPlanCheckout(id);
        if (run !== pollRun.current) return;
        if (r.status === "active") {
          setPhase("done");
          return;
        }
        if (r.status === "failed" || r.status === "expired") {
          backToForm("Paystack couldn't complete the payment. Try again.");
          return;
        }
      } catch {
        if (run !== pollRun.current) return;
        // Network blip or server busy: keep asking until the deadline.
      }
      if (Date.now() + POLL_EVERY_MS > deadline) break;
      await sleep(POLL_EVERY_MS);
      if (run !== pollRun.current) return;
    }
    setPhase("pending");
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const clean = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setError("Enter the email address where we send your receipt.");
      return;
    }
    setError("");
    setPhase("busy");
    try {
      const co = await createPlanCheckout({ plan, billing, email: clean, method });
      setChargeKes(co.amountKes);
      checkoutId.current = co.checkoutId;
      if (!co.accessCode) {
        setPhase("demo");
        return;
      }
      await loadInline();
      const Pop = paystackPop();
      if (!Pop) throw new Error("Paystack missing");
      new Pop().resumeTransaction(co.accessCode, {
        onSuccess: () => {
          if (API_MODE === "live") void confirmPayment();
          else setPhase("done");
        },
        onCancel: () => backToForm("Payment not finished. Nothing was charged."),
      });
    } catch {
      backToForm("We couldn't open the payment. Nothing was charged. Try again.");
    }
  };

  if (phase === "confirming" || phase === "pending") {
    return <Confirming pending={phase === "pending"} onCheckAgain={() => void confirmPayment()} />;
  }

  const shownKes = chargeKes ?? kes;
  const mpesaHint =
    billing === "yearly" ? "pay once for the year" : "we send a payment prompt 3 days before each renewal";

  return (
    <Shell>
      <div className="narrow sub" aria-hidden={phase === "demo" ? true : undefined}>
        <h1 className="sub-title">Start your plan</h1>

        <section className="card sub-summary" aria-labelledby="sub-plan">
          <PatternStrip pattern={info.pattern} height={6} />
          <div className="sub-summary-body">
            <h2 id="sub-plan" className="sub-plan">
              {info.name}
            </h2>
            <ul className="sub-perks">
              {info.perks.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <div className="sub-period" role="group" aria-label="Billing period">
              <button type="button" aria-pressed={billing === "monthly"} onClick={() => pickBilling("monthly")}>
                Monthly
              </button>
              <button type="button" aria-pressed={billing === "yearly"} onClick={() => pickBilling("yearly")}>
                Yearly
              </button>
            </div>
            <p className="sub-price" aria-live="polite">
              <span className="sub-amount">{`$${usd.toLocaleString("en-US")}`}</span>
              <span className="faint">
                {billing === "yearly" ? " billed yearly — 2 months free" : " / month"}
              </span>
              <span className="sub-kes muted">
                {billing === "yearly" ? `${formatKes(shownKes)} a year` : `${formatKes(shownKes)} a month`}
              </span>
            </p>
          </div>
        </section>

        <form className="sub-form" onSubmit={(e) => void submit(e)} noValidate>
          <label className="field">
            Email for your receipt
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error.startsWith("Enter") ? true : undefined}
              aria-describedby={error ? "sub-error" : undefined}
              disabled={phase === "busy"}
            />
          </label>

          <fieldset className="sub-methods">
            <legend>How you'll pay</legend>
            <label className="sub-method">
              <input
                type="radio"
                name="method"
                value="card"
                checked={method === "card"}
                onChange={() => setMethod("card")}
              />
              <span>
                <strong>Card</strong> — renews automatically
              </span>
            </label>
            <label className="sub-method">
              <input
                type="radio"
                name="method"
                value="mpesa"
                checked={method === "mpesa"}
                onChange={() => setMethod("mpesa")}
              />
              <span>
                <strong>M-Pesa</strong> — {mpesaHint}
              </span>
            </label>
          </fieldset>

          <p id="sub-error" className="sub-error" role="alert">
            {error}
          </p>

          <button ref={payBtn} type="submit" className="btn btn-block" disabled={phase === "busy"}>
            {phase === "busy" ? "Opening payment…" : `Pay ${formatKes(shownKes)}`}
          </button>
        </form>

        <p className="faint sub-foot">Cancel any time. Unused minutes roll over on Creator and up.</p>
      </div>

      {phase === "demo" && (
        <TestCheckout
          email={email.trim()}
          plan={info.name}
          kes={shownKes}
          method={method}
          onSuccess={() => setPhase("done")}
          onCancel={() => backToForm("Payment not finished. Nothing was charged.")}
        />
      )}
    </Shell>
  );
}

function Done({ name }: { name: string }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  return (
    <Shell>
      <div className="narrow center sub-done">
        <h1 ref={title} tabIndex={-1}>{`You're on ${name}`}</h1>
        <p className="muted">Your minutes are ready. We emailed your receipt.</p>
        <div className="sub-done-actions">
          <Link href="/studio" className="btn btn-block">
            Paste your script
          </Link>
          <Link href="/clips" className="btn btn-outline btn-block">
            My clips
          </Link>
        </div>
      </div>
    </Shell>
  );
}

function Confirming({ pending, onCheckAgain }: { pending: boolean; onCheckAgain(): void }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, [pending]);
  return (
    <Shell>
      <div className="narrow center sub-done">
        {pending ? (
          <>
            <h1 ref={title} tabIndex={-1}>
              Almost there
            </h1>
            <p className="muted" role="status">
              We're still confirming your payment with Paystack. You'll get an email when your plan is on.
            </p>
            <div className="sub-done-actions">
              <button type="button" className="btn btn-block" onClick={onCheckAgain}>
                Check again
              </button>
            </div>
          </>
        ) : (
          <>
            <h1 ref={title} tabIndex={-1}>
              One moment
            </h1>
            <div role="status">
              <DrumRoll />
              <p className="muted">Confirming your payment…</p>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

/** Stand-in for Paystack's screen when the server gives no access code. No money moves. */
function TestCheckout({
  email,
  plan,
  kes,
  method,
  onSuccess,
  onCancel,
}: {
  email: string;
  plan: string;
  kes: number;
  method: Method;
  onSuccess(): void;
  onCancel(): void;
}) {
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const last = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    first.current?.focus();
    return () => window.clearTimeout(timer.current);
  }, []);

  const simulate = () => {
    setBusy(true);
    last.current?.focus();
    timer.current = window.setTimeout(onSuccess, 1200);
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
    const items = panel.current.querySelectorAll<HTMLElement>("button:not(:disabled)");
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

  const how = method === "card" ? "Card" : "M-Pesa";

  return (
    <div className="co-layer" onKeyDown={onKeyDown}>
      <div className="co-backdrop" aria-hidden="true" onClick={cancel} />
      <div
        ref={panel}
        className="co-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sub-co-title"
        aria-describedby="sub-co-desc"
      >
        <div className="co-head">
          <div className="co-who">
            <span className="co-email">{email || "No email given"}</span>
            <span id="sub-co-title" className="co-amount">
              Pay <strong>{formatKes(kes)}</strong>
            </span>
          </div>
          <span className="co-tag">TEST CHECKOUT · NO MONEY MOVES</span>
        </div>
        <div className="co-body">
          <p id="sub-co-desc" className="co-note">
            {`${plan} plan by ${how}. This is a test screen: nothing is charged.`}
          </p>
          <button ref={first} type="button" className="co-pay" onClick={simulate} disabled={busy}>
            {busy ? "Confirming…" : "Simulate payment"}
          </button>
          <span className="co-live" role="status">
            {busy ? "Confirming payment" : ""}
          </span>
          <button ref={last} type="button" className="co-cancel" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
