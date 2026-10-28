import { RiseWords } from "../components/Motion";
import { Shell } from "../components/Shell";
import { Link } from "../router";

// A bead necklace with one bead missing from the middle; the stray bead floats
// gently above the gap. The string draws, the beads drop onto it one by one, then
// the stray one arrives and bobs (Motion.css .float-soft). Still under reduced motion.
const COLOURS = ["var(--red)", "var(--gold)", "var(--indigo)", "var(--green)", "var(--accent)"];
const SLOTS = 9;
const GAP = 4; // the empty slot
// The string sags from (8, 14) to (168, 14) through (88, 46): x runs evenly, y curves.
const at = (t: number) => ({ x: 8 + 160 * t, y: 14 * (1 - t) ** 2 + 2 * 46 * (1 - t) * t + 14 * t ** 2 });
const BEADS = Array.from({ length: SLOTS }, (_, i) => ({ i, ...at(i / (SLOTS - 1)) })).filter((b) => b.i !== GAP);
const STRAY = at(GAP / (SLOTS - 1));

const CSS = `
.nf-necklace { display: block; overflow: visible; }
.nf-string { fill: none; stroke: var(--field); stroke-width: 1.5; stroke-linecap: round; }
@media (prefers-reduced-motion: no-preference) {
  .nf-string { stroke-dasharray: 1; stroke-dashoffset: 1; animation: nf-draw 700ms var(--ease-out, ease-out) 100ms forwards; }
  .nf-bead { animation: nf-drop 560ms var(--ease-out, ease-out) calc(var(--i) * 70ms + 450ms) backwards; }
  .nf-stray { animation: nf-arrive 700ms var(--ease-out, ease-out) 1150ms backwards; }
}
@keyframes nf-draw { to { stroke-dashoffset: 0; } }
@keyframes nf-drop {
  0% { opacity: 0; transform: translateY(-12px); }
  60% { opacity: 1; transform: translateY(1.5px); }
  100% { opacity: 1; transform: none; }
}
@keyframes nf-arrive { from { opacity: 0; transform: translateY(-8px); } }
`;

function LostBead() {
  return (
    <svg className="nf-necklace" width="176" height="56" viewBox="0 0 176 56" aria-hidden="true">
      <style>{CSS}</style>
      <path className="nf-string" d="M8 14 Q88 46 168 14" pathLength={1} />
      {BEADS.map((b, k) => (
        <circle
          key={b.i}
          className="nf-bead"
          cx={b.x}
          cy={b.y}
          r={6.5}
          fill={COLOURS[k % COLOURS.length]}
          style={{ ["--i" as string]: k }}
        />
      ))}
      <g className="float-soft">
        <circle className="nf-stray" cx={STRAY.x} cy={STRAY.y - 20} r={6.5} fill="var(--gold)" />
      </g>
    </svg>
  );
}

export default function NotFound() {
  return (
    <Shell>
      <div className="narrow center" style={{ display: "flex", flexDirection: "column", gap: 20, alignItems: "center" }}>
        <LostBead />
        <p className="hand" style={{ fontSize: 56 }}>Pole sana.</p>
        <h1 style={{ fontSize: 32 }}>
          <RiseWords text="We couldn't find that page" delay={200} />
        </h1>
        <p className="muted">The link may be old, or the page has moved.</p>
        <Link className="btn" href="/">
          Go to the home page
        </Link>
      </div>
    </Shell>
  );
}
