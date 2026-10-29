import { Shell } from "../components/Shell";
import { Link } from "../router";

// A still bead necklace with one bead missing from the middle; the stray bead sits
// just above the gap. Decorative.
const COLOURS = ["var(--red)", "var(--gold)", "var(--indigo)", "var(--green)", "var(--accent)"];
const SLOTS = 9;
const GAP = 4; // the empty slot
// The string sags from (8, 14) to (168, 14) through (88, 46): x runs evenly, y curves.
const at = (t: number) => ({ x: 8 + 160 * t, y: 14 * (1 - t) ** 2 + 2 * 46 * (1 - t) * t + 14 * t ** 2 });
const BEADS = Array.from({ length: SLOTS }, (_, i) => ({ i, ...at(i / (SLOTS - 1)) })).filter((b) => b.i !== GAP);
const STRAY = at(GAP / (SLOTS - 1));

function LostBead() {
  return (
    <svg width="176" height="56" viewBox="0 0 176 56" aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      <path d="M8 14 Q88 46 168 14" fill="none" stroke="var(--field)" strokeWidth={1.5} strokeLinecap="round" />
      {BEADS.map((b, k) => (
        <circle key={b.i} cx={b.x} cy={b.y} r={6.5} fill={COLOURS[k % COLOURS.length]} />
      ))}
      <circle cx={STRAY.x} cy={STRAY.y - 20} r={6.5} fill="var(--gold)" />
    </svg>
  );
}

export default function NotFound() {
  return (
    <Shell>
      <div className="narrow center" style={{ display: "flex", flexDirection: "column", gap: 20, alignItems: "center" }}>
        <LostBead />
        <p className="hand" style={{ fontSize: 56 }}>Pole sana.</p>
        <h1 style={{ fontSize: 32 }}>We couldn't find that page</h1>
        <Link className="btn" href="/">
          Go to the home page
        </Link>
      </div>
    </Shell>
  );
}
