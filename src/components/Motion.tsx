// Shared pieces for page heroes and highlights. Motion is kept to a few calm places:
// the greeting crossfade and the bead wave while a voice plays. Headings and numbers
// stay still. Everything is still for visitors who ask for reduced motion.
import { Children, useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
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

/** A heading line. It used to rise in word by word; now it simply arrives with the page. */
export function RiseWords({
  text,
  as: Tag = "span",
  className,
}: {
  text: string;
  as?: ElementType;
  className?: string;
  delay?: number;
  step?: number;
}) {
  return <Tag className={["rise-words", className].filter(Boolean).join(" ")}>{text}</Tag>;
}

/** A number shown as it is (it no longer counts up). */
export function CountUp({
  value,
  format = (n: number) => Math.round(n).toLocaleString("en-US"),
  className,
}: {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  return <span className={className}>{format(value)}</span>;
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
