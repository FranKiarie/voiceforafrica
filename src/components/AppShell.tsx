import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { API_MODE } from "../lib/api";
import { supabase, useSession } from "../lib/supabase";
import { Link, navigate, usePath } from "../router";
import { formatUsd } from "../data";
import { Icon, type IconName } from "./icons";
import { KangaBand, PatternDefs, ThemeToggle } from "./Shell";
import "./AppShell.css";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Home", icon: "home" },
  { href: "/clips", label: "My clips", icon: "wave" },
  { href: "/voices", label: "Voices", icon: "mic" },
  { href: "/transcribe", label: "Transcribe", icon: "book" },
  { href: "/dubbing", label: "Dubbing", icon: "film" },
  { href: "/pricing", label: "Plans", icon: "card" },
  { href: "/verify", label: "Verify a licence", icon: "shield" },
];

export const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Every page renders its own frame, so the sidebar is built afresh on each page change.
// What it remembers between pages lives here: whether the nav has eased in yet, which
// item was lit, and which step of the flow the last page showed.
let navIntroPlayed = false;
let lastNavIndex: number | null = null;
let lastStep: number | null = null;

async function signOut() {
  try {
    await supabase.auth.signOut();
  } catch {
    // Network down: supabase-js still clears the local session.
  }
  navigate("/");
}

function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <Link href="/dashboard" className="brand app-brand" aria-label="Mikaka Voice, home" onClick={onClick}>
      <img className="logo logo-light" src="/brand/mikaka-logo-primary.png" alt="" />
      <img className="logo logo-dark" src="/brand/mikaka-logo-white.png" alt="" />
      <span className="brand-rule" />
      <span className="brand-voice">Voice</span>
    </Link>
  );
}

/**
 * Four beads beside "Step 2 of 4". Beads the last page had lit start lit; the rest
 * fill one after another (or empty, going back). Decorative: the words say the step.
 */
export function StepBeads({ step, total = 4 }: { step: number; total?: number }) {
  const [from] = useState(() => (reducedMotion() ? step : (lastStep ?? 0)));
  const [lit, setLit] = useState(from);
  useEffect(() => {
    lastStep = step;
    // Two frames, so the starting beads are drawn before they change.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setLit(step));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [step]);
  return (
    <span className="app-step-beads" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`app-step-bead${i < lit ? " on" : ""}${i === step - 1 && lit === step ? " now" : ""}`}
          // Filling, the first new bead goes first; emptying, the last lit bead goes first.
          style={{ ["--d" as string]: `${Math.max(0, step >= from ? i - from : from - 1 - i) * 120}ms` } as CSSProperties}
        />
      ))}
    </span>
  );
}

/** Rounds a dollar figure while it counts, keeping the final figure's cents (or none). */
export function usdCounter(final: number): (n: number) => string {
  const whole = Math.abs(final - Math.round(final)) < 0.005;
  return (raw) => {
    const n = Math.max(0, raw); // Counting frames can start a hair below zero; never show "-$0".
    if (n >= final) return formatUsd(final);
    return whole
      ? `$${Math.round(n).toLocaleString("en-US")}`
      : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
}

/**
 * Eases a shown number toward `value`. With `from` it counts up from there the first
 * time (after `delay` ms); later changes glide from wherever the number is. Changes of
 * `snap` or less jump straight there. Reduced motion: always the value itself.
 */
export function useEased(value: number, { duration = 420, from, delay = 0, snap = 0 }: { duration?: number; from?: number; delay?: number; snap?: number } = {}): number {
  const [shown, setShown] = useState(() => (from === undefined || reducedMotion() ? value : from));
  const now = useRef(shown);
  const begun = useRef(from === undefined);
  useEffect(() => {
    const start = now.current;
    if (reducedMotion() || Math.abs(value - start) <= snap) {
      begun.current = true;
      now.current = value;
      setShown(value);
      return;
    }
    let frame = 0;
    let t0 = 0;
    const tick = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / duration);
      const v = p >= 1 ? value : start + (value - start) * (1 - Math.pow(1 - p, 3));
      now.current = v;
      setShown(v);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    const timer = window.setTimeout(
      () => {
        begun.current = true;
        frame = requestAnimationFrame(tick);
      },
      begun.current ? 0 : delay,
    );
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [value, duration, delay, snap]);
  return shown;
}

/**
 * Frame for signed-in pages: a sidebar on the left (a drawer on phones) and the page beside it.
 * Marketing pages keep Shell.
 */
export function AppShell({ step, children }: { step?: 1 | 2 | 3 | 4; children: ReactNode }) {
  const path = usePath().replace(/\/+$/, "") || "/";
  const session = useSession();
  const [open, setOpen] = useState(false);
  const side = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const topBar = useRef<HTMLDivElement>(null);
  const main = useRef<HTMLElement>(null);
  const nav = useRef<HTMLElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const active = NAV.findIndex((n) => n.href === path);
  // Read once per page, before this page's effects update them (React's dev double run included).
  const [intro, setIntro] = useState(() => !navIntroPlayed && !reducedMotion());
  const [fromIndex] = useState(() => lastNavIndex);

  const email = session?.user?.email ?? "";
  const name = (session?.user?.user_metadata?.full_name as string | undefined)?.trim() ?? "";
  const who = name || (email ? email.split("@")[0] : API_MODE === "demo" ? "Demo account" : "Your account");

  // The drawer (phones only) is modal: the page behind is inert and can't scroll. It closes on
  // Escape, or when the screen grows wide enough for the sidebar, and hands focus back to the menu button.
  useEffect(() => {
    if (!open) return;
    const button = menuButton.current;
    const behind = [topBar.current, main.current].filter((el): el is HTMLElement => el !== null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const wide = window.matchMedia("(min-width: 901px)");
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    behind.forEach((el) => el.setAttribute("inert", ""));
    document.body.style.overflow = "hidden";
    side.current?.querySelector<HTMLElement>("a, button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
      behind.forEach((el) => el.removeAttribute("inert"));
      document.body.style.overflow = "";
      if (!wide.matches) button?.focus();
    };
  }, [open]);

  // The nav eases in on the first signed-in page only, not on every page change.
  useEffect(() => {
    navIntroPlayed = true;
    lastStep = step ?? null;
    if (!intro) return;
    const t = window.setTimeout(() => setIntro(false), 1200);
    return () => window.clearTimeout(t);
  }, [intro, step]);

  // The lit pill starts on the item the last page had lit and glides to this page's item.
  useLayoutEffect(() => {
    lastNavIndex = active >= 0 ? active : null;
    const list = nav.current;
    const pill = mark.current;
    if (!list || !pill || active < 0) return;
    const links = list.querySelectorAll<HTMLElement>("a");
    const to = links[active];
    if (!to) return;
    const place = (a: HTMLElement) => {
      pill.style.height = `${a.offsetHeight}px`;
      pill.style.transform = `translateY(${a.offsetTop}px)`;
    };
    let target = { top: to.offsetTop, height: to.offsetHeight };
    const start = fromIndex !== null && fromIndex !== active ? links[fromIndex] : undefined;
    pill.classList.remove("is-gliding");
    if (start && !reducedMotion()) {
      place(start);
      pill.getBoundingClientRect(); // Commit the start position so the change below transitions.
      pill.classList.add("is-gliding");
    }
    place(to);
    if (typeof ResizeObserver === "undefined") return;
    // Late web fonts can change the items' height: follow the item without gliding.
    const ro = new ResizeObserver(() => {
      if (to.offsetTop === target.top && to.offsetHeight === target.height) return;
      target = { top: to.offsetTop, height: to.offsetHeight };
      pill.classList.remove("is-gliding");
      place(to);
    });
    ro.observe(list);
    return () => ro.disconnect();
  }, [active, fromIndex]);

  const close = () => setOpen(false);

  return (
    <div className="app" data-open={open || undefined}>
      <a className="app-skip" href="#app-main">
        Skip to content
      </a>
      <PatternDefs />
      <KangaBand />

      <div ref={topBar} className="app-top">
        <Brand />
        <div className="app-top-actions">
          <Link href="/studio" className="btn app-top-new">
            <Icon name="plus" size={16} />
            New
          </Link>
          <button
            ref={menuButton}
            type="button"
            className="app-menu-btn"
            aria-expanded={open}
            aria-controls="app-side"
            aria-label="Menu"
            onClick={() => setOpen(true)}
          >
            <Icon name="menu" size={22} />
          </button>
        </div>
      </div>

      <div className="app-body">
        <aside
          id="app-side"
          ref={side}
          className="app-side"
          aria-label="Your studio"
          role={open ? "dialog" : undefined}
          aria-modal={open || undefined}
        >
          <div className="app-side-head">
            <Brand onClick={close} />
            <button type="button" className="app-close-btn" aria-label="Close menu" onClick={close}>
              <Icon name="close" size={20} />
            </button>
          </div>

          <Link href="/studio" className="btn btn-block app-new" onClick={close}>
            <Icon name="plus" size={18} />
            New voice-over
          </Link>

          <nav
            ref={nav}
            className={`app-nav${intro ? " is-intro" : ""}${active >= 0 ? " has-mark" : ""}`}
            aria-label="Studio"
            style={{ ["--active" as string]: Math.max(0, active) } as CSSProperties}
          >
            {active >= 0 && <span ref={mark} className={`app-nav-mark${fromIndex === null || fromIndex === active ? " is-fresh" : ""}`} aria-hidden="true" />}
            {NAV.map((n, i) => (
              <Link
                key={n.href}
                href={n.href}
                onClick={close}
                aria-current={path === n.href ? "page" : undefined}
                style={{ ["--i" as string]: i } as CSSProperties}
              >
                <Icon name={n.icon} />
                {n.label}
              </Link>
            ))}
          </nav>

          <div className="app-side-foot">
            <div className="app-account">
              <span className="app-avatar" aria-hidden="true">
                {who.charAt(0)}
              </span>
              <span className="app-who">
                <span className="app-name">{who}</span>
                {email && <span className="app-email faint">{email}</span>}
              </span>
              {session && (
                <button type="button" className="app-out" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}>
                  <Icon name="out" size={18} />
                </button>
              )}
            </div>
            <div className="app-side-links faint">
              <ThemeToggle />
              <span>
                <Link href="/terms">Terms</Link> · <Link href="/privacy">Privacy</Link>
              </span>
            </div>
          </div>
        </aside>

        {open && <div className="app-scrim" aria-hidden="true" onClick={close} />}

        <main ref={main} id="app-main" tabIndex={-1} className="app-main">
          {step && (
            <p className="app-step">
              <span>{`Step ${step} of 4`}</span>
              <StepBeads step={step} />
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
