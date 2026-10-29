import type { ReactNode } from "react";
import { Link, usePath } from "../router";
import { useTheme } from "../reveal";
import type { PatternId } from "../data";
import { hasStoredSession, useSession } from "../lib/supabase";
import { AppShell } from "./AppShell";

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
// Height of one tile of each cloth above, so a strip can shrink it to fit.
const TILE: Record<PatternId, number> = { band: 14, beads: 12, adire: 24, kente: 32, ndebele: 36, kitenge: 28, bark: 20, mud: 20 };

/** A thin band of cloth. The tile is scaled down to the band's height so every motif shows
 *  whole; a bare 8px slice of a 28px tile would show only the clipped tops of its shapes. */
export function PatternStrip({ pattern, height = 8 }: { pattern: PatternId; height?: number }) {
  const s = height / TILE[pattern];
  return (
    <svg width="100%" height={height} aria-hidden="true" style={{ display: "block" }}>
      <rect width={3200 / s} height={TILE[pattern]} fill={`url(#${pattern})`} transform={`scale(${s})`} />
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

/** Loader: an ngoma beaten by two sticks in turn, the head rippling on each hit. */
export function DrumRoll({ size = 96 }: { size?: number }) {
  return (
    <svg className="drumbeat" width={size} height={Math.round(size * 0.84)} viewBox="0 0 120 100" aria-hidden="true">
      <g className="drumbeat-sound" fill="none" stroke="#E8A33C" strokeWidth="2.5" strokeLinecap="round">
        <path className="drumbeat-sound-l" d="M30 26 L22 18 M26 34 L16 32" />
        <path className="drumbeat-sound-r" d="M90 26 L98 18 M94 34 L104 32" />
      </g>
      <g className="drumbeat-drum">
        <path d="M30 46 L38 88 Q60 96 82 88 L90 46 Z" fill="#E8A33C" stroke="#C98A26" strokeWidth="2" />
        <path d="M33 60 L41 70 L49 60 L57 70 L65 60 L73 70 L81 60 L87 64 L85 72 L35 72 L33 64 Z" fill="#D0442A" />
        <path d="M32 50 L44 60 L56 50 L68 60 L80 50 L88 56" fill="none" stroke="#1A110C" strokeWidth="1.6" strokeLinejoin="round" />
        <ellipse cx="60" cy="46" rx="30" ry="8" fill="#F6EAD7" stroke="#8A4B26" strokeWidth="2.5" />
      </g>
      <ellipse className="drumbeat-ripple drumbeat-ripple-l" cx="60" cy="46" rx="30" ry="8" fill="none" stroke="#E8A33C" strokeWidth="2" />
      <ellipse className="drumbeat-ripple drumbeat-ripple-r" cx="60" cy="46" rx="30" ry="8" fill="none" stroke="#E8A33C" strokeWidth="2" />
      <g className="drumbeat-stick drumbeat-stick-l">
        <line x1="12" y1="12" x2="50" y2="40" stroke="#8A4B26" strokeWidth="4" strokeLinecap="round" />
        <circle cx="51" cy="41" r="4.5" fill="#F6EAD7" stroke="#8A4B26" strokeWidth="2" />
      </g>
      <g className="drumbeat-stick drumbeat-stick-r">
        <line x1="108" y1="12" x2="70" y2="40" stroke="#8A4B26" strokeWidth="4" strokeLinecap="round" />
        <circle cx="69" cy="41" r="4.5" fill="#F6EAD7" stroke="#8A4B26" strokeWidth="2" />
      </g>
    </svg>
  );
}

const NAV = [
  { href: "/#voices", label: "Voices", path: "/voices" },
  { href: "/transcribe", label: "Transcribe", path: "/transcribe" },
  { href: "/dubbing", label: "Dubbing", path: "/dubbing", wideOnly: true },
  { href: "/pricing", label: "Pricing", path: "/pricing" },
  { href: "/verify", label: "Verify a licence", path: "/verify", wideOnly: true },
];

// Header-only styles: the account chip, the Sign up pill, and a 4-item cap on phones.
const HEADER_CSS = `
.site-nav { align-items: center; }
.nav-pill { border: 1px solid var(--field); border-radius: 999px; padding: 6px 16px; color: var(--text); line-height: 1.3; }
.nav-chip { display: inline-flex; align-items: center; gap: 8px; max-width: 180px; color: var(--text); }
.nav-avatar { flex: none; width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: var(--accent); color: var(--accent-ink); font-weight: 700; font-size: 14px; text-transform: uppercase; }
.nav-email { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 720px) { .nav-email { display: none; } }
@media (max-width: 480px) {
  .nav-wide-only { display: none; }
  .nav-pill { padding: 4px 14px; }
  .nav-avatar { width: 28px; height: 28px; font-size: 13px; }
}
`;

export function Header({ step }: { step?: 1 | 2 | 3 | 4 }) {
  const path = usePath();
  const session = useSession();
  const email = session?.user.email ?? "";
  const name = (session?.user.user_metadata?.full_name as string | undefined)?.trim() ?? "";
  const initial = (name || email || "?").charAt(0);
  return (
    <header className="site-header">
      <Link href={session ? "/dashboard" : "/"} className="brand">
        <img className="logo logo-light" src="/brand/mikaka-logo-primary.png" alt="Mikaka" />
        <img className="logo logo-dark" src="/brand/mikaka-logo-white.png" alt="Mikaka" />
        <span className="brand-rule" />
        <span className="brand-voice">Voice</span>
      </Link>
      {step ? (
        <span className="step">Step {step} of 4</span>
      ) : (
        <nav className="site-nav" aria-label="Main">
          <style>{HEADER_CSS}</style>
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={n.wideOnly ? "nav-wide-only" : undefined}
              aria-current={path === n.path ? "page" : undefined}
            >
              {n.label}
            </Link>
          ))}
          {session ? (
            <>
              <Link href="/dashboard" aria-current={path === "/dashboard" ? "page" : undefined}>
                Dashboard
              </Link>
              <Link
                href="/signin"
                className="nav-chip"
                title={email || undefined}
                aria-label={email ? `Your account, ${email}` : "Your account"}
                aria-current={path === "/signin" ? "page" : undefined}
              >
                <span className="nav-avatar" aria-hidden="true">
                  {initial}
                </span>
                {email && (
                  <span className="nav-email" aria-hidden="true">
                    {email}
                  </span>
                )}
              </Link>
            </>
          ) : (
            <>
              <Link href="/signin" aria-current={path === "/signin" ? "page" : undefined}>
                Sign in
              </Link>
              <Link href="/signup" className="nav-pill" aria-current={path === "/signup" ? "page" : undefined}>
                Sign up
              </Link>
            </>
          )}
        </nav>
      )}
    </header>
  );
}

export function ThemeToggle() {
  const [dark, toggle] = useTheme();
  return (
    <button type="button" className="theme-toggle" aria-pressed={dark} onClick={toggle}>
      <span className="knob" aria-hidden="true" />
      Dark mode
    </button>
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
        <nav aria-label="Footer" style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <ThemeToggle />
        </nav>
      </div>
    </footer>
  );
}

/**
 * Page frame: patterns, header, content, footer.
 * Signed-in visitors get the studio frame with its sidebar on every page except the home page.
 */
export function Shell({ step, children, footer = true }: { step?: 1 | 2 | 3 | 4; children: ReactNode; footer?: boolean }) {
  const path = usePath();
  const session = useSession();
  const signedIn = session === undefined ? hasStoredSession() : Boolean(session);
  if (signedIn && path !== "/") return <AppShell step={step}>{children}</AppShell>;
  return (
    <div className="page">
      <PatternDefs />
      <Header step={step} />
      <main>{children}</main>
      {footer && <Footer />}
    </div>
  );
}
