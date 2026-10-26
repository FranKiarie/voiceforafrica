import type { ReactNode } from "react";
import { Link, usePath } from "../router";
import type { PatternId } from "../data";

// Every cloth pattern, defined once per page. Use them as fill="url(#id)".
export function PatternDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <pattern id="band" width="30" height="14" patternUnits="userSpaceOnUse">
          <rect width="30" height="14" fill="#D0442A" />
          <path d="M15 2 L22 7 L15 12 L8 7 Z" fill="#E8A33C" />
          <circle cx="15" cy="7" r="1.6" fill="#1A110C" />
          <circle cx="1.5" cy="7" r="1.5" fill="#F6EAD7" />
          <circle cx="28.5" cy="7" r="1.5" fill="#F6EAD7" />
        </pattern>
        <pattern id="beads" width="30" height="12" patternUnits="userSpaceOnUse">
          <rect width="30" height="12" fill="#F6EAD7" />
          {[["2.5", "#D0442A"], ["7.5", "#D0442A"], ["12.5", "#1A110C"], ["17.5", "#3F57B8"], ["22.5", "#E8A33C"], ["27.5", "#2E9E6B"]].map(([cx, f]) => (
            <circle key={"a" + cx} cx={cx} cy="3" r="2.5" fill={f} />
          ))}
          {[["5", "#E8A33C"], ["10", "#3F57B8"], ["15", "#D0442A"], ["20", "#D0442A"], ["25", "#2E9E6B"]].map(([cx, f]) => (
            <circle key={"b" + cx} cx={cx} cy="9" r="2.5" fill={f} />
          ))}
        </pattern>
        <pattern id="adire" width="24" height="24" patternUnits="userSpaceOnUse">
          <rect width="24" height="24" fill="#24357A" />
          <circle cx="12" cy="12" r="7.5" fill="none" stroke="#DCE3FF" strokeWidth="1.2" />
          <circle cx="12" cy="12" r="2" fill="#DCE3FF" />
        </pattern>
        <pattern id="kente" width="32" height="32" patternUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="#E8A33C" />
          <rect width="16" height="16" fill="#1F7A4D" />
          <rect x="7" width="2" height="16" fill="#C8341E" />
          <rect x="16" y="16" width="16" height="16" fill="#1A110C" />
          <rect x="16" y="23" width="16" height="2" fill="#E8A33C" />
          <rect x="16" width="16" height="16" fill="#C8341E" />
        </pattern>
        <pattern id="ndebele" width="36" height="36" patternUnits="userSpaceOnUse">
          <rect width="36" height="36" fill="#F6EAD7" />
          <path d="M3 33 L3 15 L9 15 L9 9 L18 3 L27 9 L27 15 L33 15 L33 33 Z" fill="#E8A33C" stroke="#1A110C" strokeWidth="2.5" />
          <path d="M11 33 L11 21 L18 16 L25 21 L25 33 Z" fill="#3F57B8" stroke="#1A110C" strokeWidth="2.5" />
        </pattern>
        <pattern id="kitenge" width="28" height="28" patternUnits="userSpaceOnUse">
          <rect width="28" height="28" fill="#2E9E6B" />
          <circle cx="14" cy="14" r="9" fill="#F27A1E" />
          <circle cx="14" cy="14" r="3" fill="#F6EAD7" />
        </pattern>
        <pattern id="bark" width="20" height="20" patternUnits="userSpaceOnUse">
          <rect width="20" height="20" fill="#8A4B26" />
          <path d="M0 5 C5 3 10 7 20 4 M0 14 C7 12 12 16 20 13" fill="none" stroke="#B9703F" strokeWidth="1.5" />
        </pattern>
        <pattern id="mud" width="40" height="20" patternUnits="userSpaceOnUse">
          <rect width="40" height="20" fill="#2B1A11" />
          <path d="M0 15 L5 10 L10 15 L15 10 L20 15 L25 10 L30 15 L35 10 L40 15" fill="none" stroke="#E9D6B8" strokeWidth="1.5" />
        </pattern>
      </defs>
    </svg>
  );
}

export function KangaBand() {
  return (
    <div className="kanga" aria-hidden="true">
      <svg width="3030" height="14">
        <rect width="3030" height="14" fill="url(#band)" />
      </svg>
    </div>
  );
}

/** A small round pattern swatch, e.g. next to a voice or a country. */
export function PatternDot({ pattern, size = 14 }: { pattern: PatternId; size?: number }) {
  const r = size / 2;
  return (
    <svg width={size} height={size} aria-hidden="true" style={{ flex: "none" }}>
      <circle cx={r} cy={r} r={r - 0.5} fill={`url(#${pattern})`} stroke="var(--line)" />
    </svg>
  );
}

/** A thin pattern strip across the top of a card. */
export function PatternStrip({ pattern, height = 6 }: { pattern: PatternId; height?: number }) {
  return (
    <svg width="100%" height={height} aria-hidden="true" style={{ display: "block" }}>
      <rect width="100%" height={height} fill={`url(#${pattern})`} />
    </svg>
  );
}

/** Gold drum play/pause button with a ripple ring while playing. */
export function Drum({
  size = 96,
  playing = false,
  label,
  onClick,
}: {
  size?: number;
  playing?: boolean;
  label: string;
  onClick?: () => void;
}) {
  const icon = Math.round(size * 0.3);
  return (
    <span className="drum" style={{ width: size, height: size, ["--rim" as string]: `${Math.max(3, Math.round(size / 14))}px` }}>
      {playing && <span className="ring" aria-hidden="true" />}
      <button type="button" aria-label={label} onClick={onClick}>
        <svg width={icon} height={icon} viewBox="0 0 24 24" aria-hidden="true">
          {playing ? (
            <>
              <rect x="6" y="5" width="4" height="14" rx="1" fill="#1A110C" />
              <rect x="14" y="5" width="4" height="14" rx="1" fill="#1A110C" />
            </>
          ) : (
            <path d="M8 5 L19 12 L8 19 Z" fill="#1A110C" />
          )}
        </svg>
      </button>
    </span>
  );
}

/** Bead necklace progress: `count` beads, lit up to `progress` (0..1). */
export function BeadProgress({ progress, count = 16, label, max, now }: { progress: number; count?: number; label: string; max: number; now: number }) {
  const lit = Math.min(count, Math.floor(progress * count + 0.0001));
  return (
    <div className="beads" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(now)}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={`bead${i < lit ? " on" : ""}${i === lit - 1 ? " now" : ""}`} />
      ))}
    </div>
  );
}

export function DrumRoll() {
  return (
    <div className="drumroll" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}

const NAV = [
  { href: "/#voices", label: "Voices", path: "/voices" },
  { href: "/pricing", label: "Pricing", path: "/pricing" },
  { href: "/verify", label: "Verify a licence", path: "/verify" },
];

export function Header({ step }: { step?: 1 | 2 | 3 | 4 }) {
  const path = usePath();
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <img className="logo logo-light" src="/brand/mikaka-logo-primary.png" alt="Mikaka" />
        <img className="logo logo-dark" src="/brand/mikaka-logo-white.png" alt="Mikaka" />
        <span className="brand-rule" />
        <span className="brand-voice">Voice</span>
      </Link>
      {step ? (
        <span className="step">Step {step} of 4</span>
      ) : (
        <nav className="site-nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.path ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="wide">
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/brand/mikaka-mark.png" alt="" width={22} height={22} />
          voice.mikaka.io · Payments by Paystack
        </span>
        <nav aria-label="Footer" style={{ display: "flex", gap: 20 }}>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </div>
    </footer>
  );
}

/** Page frame: patterns, kanga band, header, content, footer. */
export function Shell({ step, children, footer = true }: { step?: 1 | 2 | 3 | 4; children: ReactNode; footer?: boolean }) {
  return (
    <div className="page">
      <PatternDefs />
      <KangaBand />
      <Header step={step} />
      <main>{children}</main>
      {footer && <Footer />}
    </div>
  );
}
