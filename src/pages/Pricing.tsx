import { useState } from "react";
import { Shell, PatternStrip } from "../components/Shell";
import { Link } from "../router";
import type { PatternId } from "../data";
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

const TIERS: Tier[] = [
  {
    name: "Pay as you go",
    pattern: "band",
    price: "$1.50",
    per: "/ min",
    line: "About KES 195 a minute. Hear 45 seconds first, no account. One language.",
    cta: "Paste your script",
    kind: "studio",
  },
  { name: "Starter", pattern: "beads", monthly: 15, line: "200 minutes, 2 languages, WAV files. Commercial licence.", cta: "Choose Starter", kind: "plan", plan: "starter" },
  {
    name: "Creator",
    pattern: "kitenge",
    monthly: 50,
    line: "750 minutes, 5 languages, style control, two-voice dialogue.",
    cta: "Choose Creator",
    kind: "plan",
    plan: "creator",
    primary: true,
  },
  { name: "Pro", pattern: "adire", monthly: 100, line: "1,600 minutes, every language, Broadcast licence for TV and radio.", cta: "Choose Pro", kind: "plan", plan: "pro" },
  { name: "Business", pattern: "kente", monthly: 350, line: "6,000 minutes, Resale licence, 10 seats.", cta: "Choose Business", kind: "plan", plan: "business" },
  {
    name: "Enterprise",
    pattern: "ndebele",
    price: "Custom",
    per: "yearly",
    line: "Your own brand voice, own capacity, invoices and an SLA.",
    cta: "Talk to us",
    kind: "contact",
  },
];

const PLANS = ["Pay as you go", "Starter", "Creator", "Pro", "Business", "Enterprise"];

const ROWS: [string, ...string[]][] = [
  ["Minutes a month", "Pay per clip", "200", "750", "1,600", "6,000", "Committed"],
  ["Languages", "1", "2", "5", "All", "All", "All"],
  ["Longest script", "5 min", "10 min", "30 min", "60 min", "3 hours", "No limit"],
  ["Free previews", "3 a day", "30 a month", "100 a month", "200 a month", "500 a month", "Fair use"],
  ["Style control", "No", "Pace", "Full", "Full", "Full + presets", "Shared presets"],
  ["Pronunciation list", "No", "No", "25 words", "200 words", "Unlimited", "Unlimited"],
  ["Two-voice dialogue", "No", "No", "Yes", "Yes", "Yes", "Yes"],
  ["Downloads", "MP3", "MP3 + WAV", "+ IVR 8 kHz", "+ IVR 8 kHz", "+ IVR 8 kHz", "Custom"],
  ["Licence", "Commercial", "Commercial", "Commercial", "Broadcast", "Broadcast + Resale", "Custom"],
  ["Seats", "1", "1", "1", "3", "10", "Unlimited + SSO"],
  ["History kept", "7 days", "30 days", "90 days", "1 year", "1 year", "Custom"],
  ["Support", "Help page", "Email", "Email", "WhatsApp", "WhatsApp + call", "Named manager"],
];

function money(usd: number): string {
  const s = usd.toFixed(2).replace(/\.?0+$/, "");
  return `$${s}`;
}

export default function Pricing() {
  const [yearly, setYearly] = useState(false);

  const priceOf = (t: Tier): { price: string; per: string } => {
    if (t.monthly === undefined) return { price: t.price ?? "", per: t.per ?? "" };
    if (yearly) return { price: money((t.monthly * 10) / 12), per: "/ month, billed yearly" };
    return { price: money(t.monthly), per: "/ month" };
  };

  return (
    <Shell>
      <section className="pricing-intro">
        <h1>Pricing</h1>
        <p className="muted">Pay per clip, or save with a plan once you make more than 10 minutes a month.</p>
        <div className="period" role="group" aria-label="Billing period">
          <button type="button" aria-pressed={!yearly} onClick={() => setYearly(false)}>
            Monthly
          </button>
          <button type="button" aria-pressed={yearly} onClick={() => setYearly(true)}>
            Yearly · 2 months free
          </button>
        </div>
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
                      <td key={i}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="faint pricing-foot">Kenyans pay in shillings by M-Pesa or card. Others pay in dollars by card.</p>
      </section>
    </Shell>
  );
}
