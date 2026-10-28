import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { InkUnderline, RiseWords, useInView } from "../components/Motion";
import { Shell, PatternStrip } from "../components/Shell";
import { Link } from "../router";
import {
  MAX_TRANSCRIBE_HOURS,
  MAX_UPLOAD_MB,
  PAYG_USD_PER_MIN,
  PLAN_TRANSCRIBE_MINUTES,
  TRANSCRIBE_PRICE,
  TRANSCRIBE_USD_PER_MIN,
  formatUsd,
  type PatternId,
} from "../data";
import type { Plan } from "../lib/api";
import "./Pricing.css";

type Tier = {
  name: string;
  pattern: PatternId;
  monthly?: number; // USD per month; undefined = not a monthly plan
  price?: string; // fixed price label (pay as you go, enterprise)
  usd?: number; // a fixed price that counts up like the plans (pay as you go)
  per?: string;
  line: string;
  extra?: ReactNode; // a second, smaller line under the summary
  cta: string;
  kind: "studio" | "plan" | "contact";
  plan?: Plan;
  primary?: boolean;
};

/** Transcription minutes a plan includes each month, e.g. "1,000". */
const txMin = (plan: keyof typeof PLAN_TRANSCRIBE_MINUTES) => PLAN_TRANSCRIBE_MINUTES[plan].toLocaleString("en-US");

const LONGEST_RECORDING = `${MAX_TRANSCRIBE_HOURS} hours`;

const TIERS: Tier[] = [
  {
    name: "Pay as you go",
    pattern: "band",
    price: formatUsd(PAYG_USD_PER_MIN),
    usd: PAYG_USD_PER_MIN,
    per: "/ min",
    line: "Hear 45 seconds first, no account. One language. Pay by M-Pesa or card.",
    extra: (
      <>
        {`Transcription: ${TRANSCRIBE_PRICE}, counted per started minute. Up to ${LONGEST_RECORDING} a recording, no account needed. `}
        <Link href="/transcribe">Transcribe a recording</Link>
      </>
    ),
    cta: "Paste your script",
    kind: "studio",
  },
  {
    name: "Starter",
    pattern: "beads",
    monthly: 15,
    line: `200 voice minutes + ${txMin("starter")} transcription minutes, 2 languages, WAV, M4A and OGG downloads. Commercial licence.`,
    cta: "Choose Starter",
    kind: "plan",
    plan: "starter",
  },
  {
    name: "Creator",
    pattern: "kitenge",
    monthly: 50,
    line: `750 voice minutes + ${txMin("creator")} transcription minutes, 5 languages, style control, two-voice dialogue.`,
    cta: "Choose Creator",
    kind: "plan",
    plan: "creator",
    primary: true,
  },
  {
    name: "Pro",
    pattern: "adire",
    monthly: 100,
    line: `1,600 voice minutes + ${txMin("pro")} transcription minutes, every language, Broadcast licence for TV and radio.`,
    cta: "Choose Pro",
    kind: "plan",
    plan: "pro",
  },
  {
    name: "Business",
    pattern: "kente",
    monthly: 350,
    line: `6,000 voice minutes + ${txMin("business")} transcription minutes, Resale licence, 10 seats.`,
    cta: "Choose Business",
    kind: "plan",
    plan: "business",
  },
  {
    name: "Enterprise",
    pattern: "ndebele",
    price: "Custom",
    per: "yearly",
    line: "Your own brand voice, own capacity, agreed transcription minutes, invoices and an SLA.",
    extra: (
      <>
        {"Dubbing is available too, into African languages and accents. "}
        <Link href="/dubbing">About dubbing</Link>
      </>
    ),
    cta: "Talk to us",
    kind: "contact",
  },
];

const PLANS = ["Pay as you go", "Starter", "Creator", "Pro", "Business", "Enterprise"];

/** Not included: a dash on screen, words for screen readers. */
const NONE = "—";

const ROWS: [string, ...string[]][] = [
  ["Voice minutes a month", "Pay per clip", "200", "750", "1,600", "6,000", "Committed"],
  [
    "Transcription minutes a month",
    TRANSCRIBE_PRICE,
    txMin("starter"),
    txMin("creator"),
    txMin("pro"),
    txMin("business"),
    "Committed",
  ],
  ["Languages", "1", "2", "5", "All", "All", "All"],
  ["Longest script", "5 min", "10 min", "30 min", "60 min", "3 hours", "No limit"],
  ["Longest recording to transcribe", ...PLANS.map(() => LONGEST_RECORDING)],
  ["Free previews", "3 a day", "30 a month", "100 a month", "200 a month", "500 a month", "Fair use"],
  ["Style control", "No", "Pace", "Full", "Full", "Full + presets", "Shared presets"],
  ["Pronunciation list", "No", "No", "25 words", "200 words", "Unlimited", "Unlimited"],
  ["Two-voice dialogue", "No", "No", "Yes", "Yes", "Yes", "Yes"],
  ["Audio versions", "MP3", "MP3, WAV, M4A, OGG", "+ phone 8 kHz (WAV, μ-law, A-law)", "+ phone 8 kHz", "+ phone 8 kHz", "Custom"],
  ["Transcripts", ...PLANS.map(() => "TXT + SRT + VTT")],
  ["Dubbing", NONE, NONE, NONE, NONE, NONE, "Yes, talk to us"],
  ["Licence", "Commercial", "Commercial", "Commercial", "Broadcast", "Broadcast + Resale", "Custom"],
  ["Seats", "1", "1", "1", "3", "10", "Unlimited + SSO"],
  ["History kept", "7 days", "30 days", "90 days", "1 year", "1 year", "Custom"],
  ["Support", "Help page", "Email", "Email", "WhatsApp", "WhatsApp + call", "Named manager"],
];

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * Cards matching `selector` rise in as they scroll into view; cards that arrive
 * together ripple `step` ms apart. The rise itself lives in Pricing.css and takes
 * over from the site-wide scroll reveal for these cards, so each moves once.
 */
function useRiseIn<T extends HTMLElement>(selector: string, step = 80) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter((el) => el.dataset.rise !== "in");
    const show = (els: HTMLElement[]) =>
      els.forEach((el, i) => {
        el.style.setProperty("--rise-delay", `${Math.min(i, 4) * step}ms`);
        el.dataset.rise = "in";
      });
    if (reduced() || typeof IntersectionObserver === "undefined") {
      show(items);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        const due = entries
          .filter((e) => e.isIntersecting || e.boundingClientRect.bottom < 0)
          .map((e) => e.target as HTMLElement)
          .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
        due.forEach((el) => io.unobserve(el));
        show(due);
      },
      { rootMargin: "0px 0px -6% 0px" },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [selector, step]);
  return ref;
}

/** "$15" for whole amounts, "$12.50" otherwise, for any figure on the way there. */
function usdLike(target: number, n: number): string {
  const whole = Math.abs(target - Math.round(target)) < 0.005;
  return whole
    ? `$${Math.round(n).toLocaleString("en-US")}`
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * A plan price that counts up from $0 the first time it is seen, then glides to the
 * new figure when the billing period changes. Screen readers get the final price only.
 */
function PriceCount({ value }: { value: number }) {
  // No inset: the count starts as the card rises in, so "$0" never sits on screen.
  const [ref, seen] = useInView<HTMLSpanElement>("0px");
  const [shown, setShown] = useState(() => (reduced() ? value : 0));
  const now = useRef(shown);
  const counted = useRef(false);
  useEffect(() => {
    if (!seen) return;
    if (reduced()) {
      now.current = value;
      setShown(value);
      return;
    }
    const from = now.current;
    const duration = counted.current ? 420 : 900;
    const start = performance.now();
    let frame = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const n = from + (value - from) * (1 - Math.pow(1 - k, 3));
      now.current = n;
      setShown(n);
      if (k < 1) frame = requestAnimationFrame(tick);
      else counted.current = true;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [seen, value]);
  return (
    <span ref={ref} className="amount">
      <span className="sr-only">{formatUsd(value)}</span>
      <span aria-hidden="true">{usdLike(value, shown)}</span>
    </span>
  );
}

type Box = { l: string; m: string; r: string; h: string };

/** Monthly / Yearly, with a dark pill that slides to the chosen one. */
function PeriodSwitch({ yearly, onChange }: { yearly: boolean; onChange: (yearly: boolean) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const el = group.current;
    if (!el) return;
    const measure = () => {
      const b = el.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if (!b) return;
      const x = b.offsetLeft;
      const y = b.offsetTop;
      const w = b.offsetWidth;
      const h = b.offsetHeight;
      // Two round caps and a stretched middle, all moved by transform only, so the
      // pill keeps its round ends while it slides and changes width.
      const next: Box = {
        l: `translate(${x}px, ${y}px)`,
        m: `translate(${x + h / 2 - 0.5}px, ${y}px) scaleX(${Math.max(0, w - h + 1) / 100})`,
        r: `translate(${x + w - h}px, ${y}px)`,
        h: `${h}px`,
      };
      setBox((prev) => (prev && prev.l === next.l && prev.m === next.m && prev.r === next.r && prev.h === next.h ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll("button").forEach((b) => ro.observe(b));
    return () => ro.disconnect();
  }, [yearly]);
  return (
    <div ref={group} className={`period${box ? " has-slider" : ""}`} role="group" aria-label="Billing period">
      {box && (
        <span className="period-slider" aria-hidden="true" style={{ ["--ph" as string]: box.h }}>
          <span className="ps-cap" style={{ transform: box.l }} />
          <span className="ps-mid" style={{ transform: box.m }} />
          <span className="ps-cap" style={{ transform: box.r }} />
        </span>
      )}
      <button type="button" aria-pressed={!yearly} onClick={() => onChange(false)}>
        Monthly
      </button>
      <button type="button" aria-pressed={yearly} onClick={() => onChange(true)}>
        Yearly · 2 months free
      </button>
    </div>
  );
}

export default function Pricing() {
  const [yearly, setYearly] = useState(false);
  const grid = useRiseIn<HTMLElement>(".tier");
  const more = useRiseIn<HTMLDivElement>(".more-card");

  const priceOf = (t: Tier): { price: ReactNode; per: string } => {
    if (t.monthly === undefined) {
      // Pay as you go counts up too; Enterprise stays "Custom".
      const price = t.usd !== undefined ? <PriceCount value={t.usd} /> : <span className="amount">{t.price}</span>;
      return { price, per: t.per ?? "" };
    }
    if (yearly) return { price: <PriceCount value={(t.monthly * 10) / 12} />, per: "/ month, billed yearly" };
    return { price: <PriceCount value={t.monthly} />, per: "/ month" };
  };

  return (
    <Shell>
      <section className="pricing-intro">
        <h1>
          <InkUnderline delay={420}>
            <RiseWords text="Pricing" />
          </InkUnderline>
        </h1>
        <p className="muted">Pay per clip, or save with a plan once you make more than 8 minutes a month.</p>
        <PeriodSwitch yearly={yearly} onChange={setYearly} />
      </section>

      <section ref={grid} className="pricing-grid wide" aria-label="Plans">
        {TIERS.map((t) => {
          const { price, per } = priceOf(t);
          const cls = t.primary ? "btn btn-block" : "btn btn-outline btn-block";
          return (
            <article key={t.name} className={`card tier${t.primary ? " tier-primary" : ""}`}>
              <PatternStrip pattern={t.pattern} />
              <div className="tier-body">
                <h2>{t.name}</h2>
                <p className="tier-price">
                  {price}
                  <span key={per} className="faint tier-per">
                    {per}
                  </span>
                </p>
                <div className="tier-text">
                  <p className="muted tier-line">{t.line}</p>
                  {t.extra && <p className="faint tier-extra">{t.extra}</p>}
                </div>
                {t.kind === "studio" && (
                  <Link href="/studio" className={cls}>
                    {t.cta}
                  </Link>
                )}
                {t.kind === "plan" && t.plan && (
                  <Link href={`/subscribe?plan=${t.plan}&billing=${yearly ? "yearly" : "monthly"}`} className={cls}>
                    {t.cta}
                  </Link>
                )}
                {t.kind === "contact" && (
                  <a href="mailto:support@mikaka.io" className={cls}>
                    {t.cta}
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </section>

      <section className="wide pricing-compare">
        <details>
          <summary>Compare all features</summary>
          <div className="compare-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Feature</span>
                  </th>
                  {PLANS.map((p) => (
                    <th scope="col" key={p}>
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([label, ...cells], r) => (
                  <tr key={label} style={{ ["--r" as string]: r }}>
                    <th scope="row">{label}</th>
                    {cells.map((c, i) => (
                      <td key={i}>
                        {c === NONE ? (
                          <>
                            <span aria-hidden="true">{NONE}</span>
                            <span className="sr-only">Not included</span>
                          </>
                        ) : (
                          c
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="wide pricing-more" aria-labelledby="more-title">
        <h2 id="more-title">Transcription and dubbing</h2>
        <div ref={more} className="more-grid">
          <article className="card more-card">
            <PatternStrip pattern="bark" />
            <div className="more-body">
              <h3>Transcription</h3>
              <p className="tier-price">
                <span className="amount">{formatUsd(TRANSCRIBE_USD_PER_MIN)}</span>
                <span className="faint">/ min</span>
              </p>
              <p className="muted more-line">
                {`Upload a recording of up to ${LONGEST_RECORDING} or ${MAX_UPLOAD_MB} MB and get the words back as TXT, SRT and VTT files. Every started minute counts. No account needed; plans include transcription minutes each month.`}
              </p>
              <Link href="/transcribe" className="btn btn-outline">
                Transcribe a recording
              </Link>
            </div>
          </article>
          <article className="card more-card">
            <PatternStrip pattern="mud" />
            <div className="more-body">
              <h3>Dubbing</h3>
              <p className="more-for">For enterprises</p>
              <p className="muted more-line">
                We dub your videos and audio into African languages and accents. Pricing is agreed per project.
              </p>
              <Link href="/dubbing" className="btn btn-outline">
                About dubbing
              </Link>
            </div>
          </article>
        </div>
        <p className="faint pricing-foot">Prices are in US dollars. You pay the same amount in Kenyan shillings by M-Pesa or card; your bank converts card payments.</p>
      </section>
    </Shell>
  );
}
