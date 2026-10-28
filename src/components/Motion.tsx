// Shared motion pieces for page heroes and highlights. Every one of them shows its
// final state at once for visitors who ask for reduced motion.
import { Children, Fragment, useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import "./Motion.css";

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** True once the element has scrolled into view (and stays true). */
export function useInView<T extends Element>(rootMargin = "0px 0px -10% 0px") {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (reduced() || !("IntersectionObserver" in window)) {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, rootMargin]);
  return [ref, seen] as const;
}

/**
 * A line of text whose words rise in one after another. Screen readers get the
 * plain text once; the animated words are hidden from them.
 */
export function RiseWords({
  text,
  as: Tag = "span",
  className,
  delay = 0,
  step = 70,
}: {
  text: string;
  as?: ElementType;
  className?: string;
  delay?: number;
  step?: number;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  return (
    <Tag className={["rise-words", className].filter(Boolean).join(" ")}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((w, i) => (
          // The space sits between the inline-block words, so it shows and the line can wrap there.
          <Fragment key={i}>
            <span className="rw" style={{ ["--rw-delay" as string]: `${delay + i * step}ms` }}>
              {w}
            </span>
            {i < words.length - 1 ? " " : ""}
          </Fragment>
        ))}
      </span>
    </Tag>
  );
}

/** Counts up to `value` the first time it scrolls into view. */
export function CountUp({
  value,
  duration = 1100,
  format = (n: number) => Math.round(n).toLocaleString("en-US"),
  className,
}: {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const [ref, seen] = useInView<HTMLSpanElement>();
  const [shown, setShown] = useState(() => (reduced() ? value : 0));
  useEffect(() => {
    if (!seen) return;
    if (reduced()) {
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      // rAF can stamp a frame just before `start`; never show "-0".
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(value * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [seen, value, duration]);
  return (
    <span ref={ref} className={className} aria-label={format(value)}>
      <span aria-hidden="true">{format(shown)}</span>
    </span>
  );
}

/**
 * Shows one child at a time, crossfading to the next every `interval` ms while on
 * screen. Reduced motion: the first child only, no cycling. Not announced.
 */
export function Cycle({ children, interval = 2600, className }: { children: ReactNode; interval?: number; className?: string }) {
  const items = Children.toArray(children);
  const [i, setI] = useState(0);
  const [ref, seen] = useInView<HTMLSpanElement>("0px");
  useEffect(() => {
    if (!seen || reduced() || items.length < 2) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") setI((n) => (n + 1) % items.length);
    }, interval);
    return () => window.clearInterval(id);
  }, [seen, interval, items.length]);
  return (
    <span ref={ref} className={["cycle", className].filter(Boolean).join(" ")} aria-live="off">
      <span key={i} className="cycle-item">
        {items[i]}
      </span>
    </span>
  );
}

const WAVE_COLORS = ["var(--red)", "var(--gold)", "var(--indigo)", "var(--green)", "var(--accent)"];

/**
 * A row of beads that rises and falls like speech. Idle it breathes slowly;
 * `speaking` makes it livelier (for example while a sample plays). Decorative.
 */
export function BeadWave({ beads = 32, speaking = false, className }: { beads?: number; speaking?: boolean; className?: string }) {
  // Fixed pseudo-random shape so the wave looks like a phrase, not noise.
  const shape = Array.from({ length: beads }, (_, k) => {
    const x = Math.sin(k * 12.9898) * 43758.5453;
    const r = x - Math.floor(x);
    const envelope = Math.sin((Math.PI * (k + 0.5)) / beads);
    return 0.25 + 0.75 * envelope * (0.45 + 0.55 * r);
  });
  return (
    <div className={["bead-wave", speaking ? "is-speaking" : "", className].filter(Boolean).join(" ")} aria-hidden="true">
      {shape.map((h, k) => (
        <span
          key={k}
          className="bw-bead"
          style={{
            ["--h" as string]: h.toFixed(3),
            ["--bw-delay" as string]: `${(k * 83) % 900}ms`,
            ["--bw-dur" as string]: `${900 + ((k * 137) % 700)}ms`,
            background: WAVE_COLORS[k % WAVE_COLORS.length],
          }}
        />
      ))}
    </div>
  );
}

/** A hand-drawn underline that draws itself under the text it wraps. */
export function InkUnderline({ children, delay = 500, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <span className={["ink-under", className].filter(Boolean).join(" ")}>
      {children}
      <svg className="ink-under-line" viewBox="0 0 300 16" preserveAspectRatio="none" aria-hidden="true">
        <path
          d="M4 11 C 60 4, 120 14, 180 8 S 270 5, 296 9"
          pathLength={1}
          style={{ ["--ink-delay" as string]: `${delay}ms` }}
        />
      </svg>
    </span>
  );
}
