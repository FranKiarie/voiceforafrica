import { useState } from "react";
import { InkUnderline } from "../components/Motion";
import { Shell, PatternStrip } from "../components/Shell";
import { Link } from "../router";
import {
  MAX_TRANSCRIBE_HOURS,
  MAX_UPLOAD_MB,
  PAYG_USD_PER_MIN,
  PLAN_TRANSCRIBE_MINUTES,
  PREVIEW_SECONDS,
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
  per?: string;
  line: string;
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
    per: "/ min",
    line: `Hear ${PREVIEW_SECONDS} seconds free, no account. One language.`,
    cta: "Paste your script",
    kind: "studio",
  },
  {
    name: "Starter",
    pattern: "beads",
    monthly: 15,
    line: `200 voice + ${txMin("starter")} transcription minutes, 2 languages, Commercial licence.`,
    cta: "Choose Starter",
    kind: "plan",
    plan: "starter",
  },
  {
    name: "Creator",
    pattern: "kitenge",
    monthly: 50,
    line: `750 voice + ${txMin("creator")} transcription minutes, 5 languages, two-voice dialogue.`,
    cta: "Choose Creator",
    kind: "plan",
    plan: "creator",
    primary: true,
  },
  {
    name: "Pro",
    pattern: "adire",
    monthly: 100,
    line: `1,600 voice + ${txMin("pro")} transcription minutes, every language, Broadcast licence.`,
    cta: "Choose Pro",
    kind: "plan",
    plan: "pro",
  },
  {
    name: "Business",
    pattern: "kente",
    monthly: 350,
    line: `6,000 voice + ${txMin("business")} transcription minutes, Resale licence, 10 seats.`,
    cta: "Choose Business",
    kind: "plan",
    plan: "business",
  },
  {
    name: "Enterprise",
    pattern: "ndebele",
    price: "Custom",
    per: "yearly",
    line: "Your own brand voice, invoices and an SLA.",
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

/** Monthly / Yearly. The chosen one is filled. */
function PeriodSwitch({ yearly, onChange }: { yearly: boolean; onChange: (yearly: boolean) => void }) {
  return (
    <div className="period" role="group" aria-label="Billing period">
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

  const priceOf = (t: Tier): { price: string; per: string } => {
    if (t.monthly === undefined) return { price: t.price ?? "", per: t.per ?? "" };
    if (yearly) return { price: formatUsd((t.monthly * 10) / 12), per: "/ month, billed yearly" };
    return { price: formatUsd(t.monthly), per: "/ month" };
  };

  return (
    <Shell>
      <section className="pricing-intro">
        <h1>
          <InkUnderline>Pricing</InkUnderline>
        </h1>
        <p className="muted">Pay per clip, or save with a plan from 8 minutes a month.</p>
        <PeriodSwitch yearly={yearly} onChange={setYearly} />
      </section>

      <section className="pricing-grid wide" aria-label="Plans">
        {TIERS.map((t) => {
          const { price, per } = priceOf(t);
          const cls = t.primary ? "btn btn-block" : "btn btn-outline btn-block";
          return (
            <article key={t.name} className={`card tier${t.primary ? " tier-primary" : ""}`}>
              <PatternStrip pattern={t.pattern} />
              <div className="tier-body">
                <h2>{t.name}</h2>
                <p className="tier-price">
                  <span className="amount">{price}</span>
                  <span className="faint">{per}</span>
                </p>
                <p className="muted tier-line">{t.line}</p>
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
                {ROWS.map(([label, ...cells]) => (
                  <tr key={label}>
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
        <div className="more-grid">
          <article className="card more-card">
            <PatternStrip pattern="bark" />
            <div className="more-body">
              <h3>Transcription</h3>
              <p className="tier-price">
                <span className="amount">{formatUsd(TRANSCRIBE_USD_PER_MIN)}</span>
                <span className="faint">/ min</span>
              </p>
              <p className="muted more-line">
                {`Up to ${LONGEST_RECORDING} or ${MAX_UPLOAD_MB} MB, billed per started minute. No account needed.`}
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
              <p className="muted more-line">Into African languages and accents, quoted per project.</p>
              <Link href="/dubbing" className="btn btn-outline">
                About dubbing
              </Link>
            </div>
          </article>
        </div>
        <p className="faint pricing-foot">Prices are in US dollars. Pay the same in Kenyan shillings by M-Pesa or card.</p>
      </section>
    </Shell>
  );
}
