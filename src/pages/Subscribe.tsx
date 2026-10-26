import { Shell } from "../components/Shell";
import { KES_PER_MINUTE, formatKes } from "../data";
import { Link } from "../router";

// Monthly plans are on the pricing page so people can see them.
// They are not for sale: this page must not pretend a payment went through.
export default function Subscribe() {
  return (
    <Shell>
      <div className="narrow" style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 40, marginBottom: 16 }}>Plans aren't on sale yet</h1>
        <p className="muted" style={{ marginBottom: 28 }}>
          You can buy a clip today at {formatKes(KES_PER_MINUTE)} a minute. Hear 45 seconds free, then pay with M-Pesa or card.
          Monthly plans will open later.
        </p>
        <Link href="/studio" className="btn">
          Paste your script
        </Link>
        <p style={{ marginTop: 20 }}>
          <Link href="/pricing" className="muted">
            Back to pricing
          </Link>
        </p>
      </div>
    </Shell>
  );
}
