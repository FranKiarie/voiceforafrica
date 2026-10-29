import { useEffect, useState } from "react";

// Blocks that rise in as they scroll into view. Kept generic so every page gets
// the same motion without each one opting in. The motion lives in motion.css:
// data-reveal="wait" holds a block back, data-reveal="in" plays a short rise.
const TARGETS = [
  "main h1",
  "main h2",
  "main section",
  "main article",
  "main .card",
  "main form",
  "main details",
  "main ul > li",
  "main table",
  "main .drum",
  "main .beads",
].join(",");

const SKIP = "[role='dialog'], .co-layer, header, [class*='marquee'], [class*='lang-']";

// Siblings that arrive together ripple in 40 ms apart, never more than 160 ms late.
const STAGGER_MS = 40;
const STAGGER_CAP_MS = 160;

/** Plays the rise on blocks coming into view, rippling siblings that share a parent. */
function reveal(els: HTMLElement[]) {
  const seen = new Map<Element | null, number>();
  for (const el of els) {
    const i = seen.get(el.parentElement) ?? 0;
    seen.set(el.parentElement, i + 1);
    const delay = Math.min(i * STAGGER_MS, STAGGER_CAP_MS);
    if (delay) el.style.setProperty("--reveal-delay", `${delay}ms`);
    else el.style.removeProperty("--reveal-delay");
    el.dataset.reveal = "in";
  }
}

/** Every reveal target in `root` (itself included), in document order. */
function targetsIn(root: Element): HTMLElement[] {
  const found = Array.from(root.querySelectorAll<HTMLElement>(TARGETS));
  if (root instanceof HTMLElement && root.matches(TARGETS)) found.unshift(root);
  return found;
}

/**
 * Holds back blocks below the fold and lets them rise in as they scroll into view.
 * Anything on screen when a page opens is shown straight away, so no page opens
 * blank. Blocks that arrive later (loaded clips, the next step of a form) rise in
 * where they land.
 */
export function useReveal(path: string) {
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver((entries) => {
      const due: HTMLElement[] = [];
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const el = e.target as HTMLElement;
        if (el.dataset.reveal === "wait") due.push(el);
      }
      if (due.length) reveal(due);
    });

    const hold = (el: HTMLElement) => {
      el.dataset.reveal = "wait";
      io.observe(el);
    };

    const known = new WeakSet<Element>();
    // `opening` is true while a page mounts (or a whole new page frame appears, as
    // when signing in swaps the site frame for the studio): what is on screen then
    // stays exactly as it is. Blocks that arrive later rise in, even on screen.
    const mark = (els: HTMLElement[], opening: boolean) => {
      const fold = window.innerHeight;
      const fresh = new Set<Element>();
      const now: HTMLElement[] = [];
      for (const el of els) {
        if (known.has(el)) continue;
        known.add(el);
        if (el.closest(SKIP)) continue;
        // Not rendered (a closed disclosure, a hidden panel): leave it alone.
        if (el.getClientRects().length === 0) continue;
        // Inside a block that is still held back, or rising in right now: it rides along.
        const host = el.parentElement?.closest<HTMLElement>("[data-reveal]");
        if (host && (host.dataset.reveal === "wait" || fresh.has(host))) continue;
        const onScreen = el.getBoundingClientRect().top < fold;
        if (opening) {
          // An earlier run (React's dev double effect) may have held it back.
          if (onScreen) delete el.dataset.reveal;
          else hold(el);
          continue;
        }
        fresh.add(el);
        if (onScreen) {
          el.dataset.reveal = "in";
          now.push(el);
        } else {
          hold(el);
        }
      }
      if (now.length) reveal(now);
    };

    mark(Array.from(document.querySelectorAll<HTMLElement>(TARGETS)), true);

    // Pages that load data after mounting (clips, pricing toggles, the next step) add blocks later.
    const mo = new MutationObserver((records) => {
      const opening: HTMLElement[] = [];
      const late: HTMLElement[] = [];
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (!(n instanceof Element) || !n.isConnected) return;
          const frame = n.matches("main") || n.querySelector("main") !== null;
          (frame ? opening : late).push(...targetsIn(n));
        });
      }
      if (opening.length) mark(opening, true);
      if (late.length) mark(late, false);
    });
    mo.observe(document.getElementById("root") ?? document.body, { childList: true, subtree: true });

    // Once a block has risen in, drop the marker so nothing replays it later
    // (a panel shown again, a resize across a breakpoint).
    const settle = (e: AnimationEvent) => {
      const el = e.target;
      if (e.animationName !== "reveal-in" || !(el instanceof HTMLElement) || el.dataset.reveal !== "in") return;
      delete el.dataset.reveal;
      el.style.removeProperty("--reveal-delay");
    };
    document.addEventListener("animationend", settle);

    // Safety net for browsers that throttle the observer: reveal whatever is on
    // screen (or already scrolled past) after a beat, and again whenever the page scrolls.
    let frame = 0;
    const sweep = () => {
      frame = 0;
      const fold = window.innerHeight;
      const due: HTMLElement[] = [];
      document.querySelectorAll<HTMLElement>('[data-reveal="wait"]').forEach((el) => {
        if (el.getBoundingClientRect().top < fold) {
          io.unobserve(el);
          due.push(el);
        }
      });
      if (due.length) reveal(due);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(sweep);
    };
    const fallback = window.setTimeout(sweep, 1200);
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      window.clearTimeout(fallback);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("animationend", settle);
      if (frame) window.cancelAnimationFrame(frame);
      io.disconnect();
      mo.disconnect();
      // Never leave a block held back once nothing is watching for it.
      document.querySelectorAll<HTMLElement>('[data-reveal="wait"]').forEach((el) => {
        delete el.dataset.reveal;
      });
    };
  }, [path]);
}

const THEME_KEY = "mv.theme";

/** Cream by default; dark brown only when the visitor turns it on. */
export function useTheme(): [boolean, () => void] {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      // Private mode: the choice lasts for this visit only.
    }
  };
  return [dark, toggle];
}
