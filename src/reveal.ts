import { useEffect, useState } from "react";

// Blocks that fade up as they scroll into view. Kept generic so every page gets
// the same motion without each one opting in.
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

const SKIP = "[role='dialog'], header, .kanga, [class*='marquee'], [class*='lang-']";

/** Marks blocks on the current page and reveals them as they enter the viewport. */
export function useReveal(path: string) {
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );

    const mark = () => {
      // Stagger siblings that share a parent so lists and grids ripple in.
      const seen = new Map<Element | null, number>();
      for (const el of document.querySelectorAll<HTMLElement>(TARGETS)) {
        if (el.closest(SKIP)) continue;
        if (el.dataset.reveal === undefined) {
          // Only the outermost hidden block animates; its children ride along.
          if (el.parentElement?.closest("[data-reveal]:not(.is-in)")) continue;
          const i = seen.get(el.parentElement) ?? 0;
          seen.set(el.parentElement, i + 1);
          el.dataset.reveal = "";
          el.style.setProperty("--reveal-delay", `${Math.min(i * 70, 420)}ms`);
        }
        // Re-observe anything still hidden: an earlier observer may have been torn down.
        if (!el.classList.contains("is-in")) io.observe(el);
      }
    };

    mark();
    // Pages that load data after mounting (clips, pricing toggles) add blocks later.
    const mo = new MutationObserver(() => mark());
    const main = document.querySelector("main");
    if (main) mo.observe(main, { childList: true, subtree: true });
    // Safety net for browsers that throttle the observer: reveal whatever is on
    // screen after a beat, and again whenever the page scrolls.
    let frame = 0;
    const sweep = () => {
      frame = 0;
      document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-in)").forEach((el) => {
        if (el.getBoundingClientRect().top < window.innerHeight * 0.95) el.classList.add("is-in");
      });
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(sweep);
    };
    const fallback = window.setTimeout(sweep, 1200);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(fallback);
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      io.disconnect();
      mo.disconnect();
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
