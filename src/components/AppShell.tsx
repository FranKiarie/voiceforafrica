import { useEffect, useRef, useState, type ReactNode } from "react";
import { API_MODE } from "../lib/api";
import { supabase, useSession } from "../lib/supabase";
import { Link, navigate, usePath } from "../router";
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

/** Four beads beside "Step 2 of 4": one lit for each step reached. Decorative: the words say the step. */
function StepBeads({ step, total = 4 }: { step: number; total?: number }) {
  return (
    <span className="app-step-beads" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`app-step-bead${i < step ? " on" : ""}${i === step - 1 ? " now" : ""}`} />
      ))}
    </span>
  );
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

          <nav className="app-nav" aria-label="Studio">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} onClick={close} aria-current={path === n.href ? "page" : undefined}>
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
