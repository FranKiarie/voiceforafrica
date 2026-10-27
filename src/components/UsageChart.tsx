import { useState, type KeyboardEvent } from "react";
import { formatDuration } from "../data";
import type { Clip } from "../lib/api";
import "./UsageChart.css";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Axis steps in seconds; the first that needs at most three gridlines wins.
const STEPS = [15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

export type Day = { date: Date; seconds: number; clips: number };

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const dayLabel = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const longDayLabel = (d: Date) => `${WEEKDAYS[d.getDay()]} ${dayLabel(d)}`;
const tickLabel = (s: number) => (s < 60 ? `${s} s` : `${s / 60} min`);
// Labels near either end of the chart hang inwards so they stay inside the card.
const edgeOf = (i: number, n: number) => (i < 3 ? " is-start" : i > n - 4 ? " is-end" : "");

/** Seconds of audio and clip count for each of the last `count` days, oldest first, in local time. */
export function lastDays(clips: Clip[], count = 30): Day[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: Day[] = [];
  const byKey = new Map<string, Day>();
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const day = { date, seconds: 0, clips: 0 };
    days.push(day);
    byKey.set(dayKey(date), day);
  }
  for (const c of clips) {
    const at = new Date(c.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    const day = byKey.get(dayKey(at));
    if (!day) continue;
    day.seconds += c.seconds ?? 0;
    day.clips += 1;
  }
  return days;
}

/** Column chart of audio made per day. Hover or arrow keys show each day. */
export function UsageChart({ days }: { days: Day[] }) {
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(0, ...days.map((d) => d.seconds));
  const step = STEPS.find((s) => max / s <= 3) ?? 3600 * Math.ceil(max / 3 / 3600);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  // Label one bar only: the most recent busiest day.
  let peak = -1;
  days.forEach((d, i) => {
    if (max > 0 && d.seconds === max) peak = i;
  });

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = days.length - 1;
    const now = active ?? last;
    const next =
      e.key === "ArrowLeft" ? Math.max(0, now - 1) : e.key === "ArrowRight" ? Math.min(last, now + 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  const shown = active !== null ? days[active] : null;
  const edge = active === null ? "" : edgeOf(active, days.length);
  const busy = days.filter((d) => d.clips > 0);

  return (
    <div className="uchart">
      <div className="uchart-frame">
        {ticks.map((t) => (
          <div key={t} className="uchart-tick" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden="true">
            <span className="faint">{tickLabel(t)}</span>
          </div>
        ))}

        <div
          className="uchart-plot"
          tabIndex={0}
          role="group"
          aria-label="Audio made per day, last 30 days. Use the arrow keys to read each day."
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
          onPointerLeave={(e) => {
            // A finger lifting also "leaves"; keep the tapped day showing until the next tap.
            if (e.pointerType === "mouse") setActive(null);
          }}
        >
          {days.map((d, i) => (
            <div
              key={d.date.getTime()}
              className={`uchart-col${active === i ? " is-active" : ""}`}
              onPointerEnter={() => setActive(i)}
              onPointerDown={() => setActive(i)}
              aria-hidden="true"
            >
              {d.seconds > 0 && <span className="uchart-bar" style={{ height: `max(3px, ${(d.seconds / top) * 100}%)` }} />}
              {i === peak && active === null && (
                <span className={`uchart-peak${edgeOf(i, days.length)}`} style={{ bottom: `${(d.seconds / top) * 100}%` }}>
                  {formatDuration(d.seconds)}
                </span>
              )}
            </div>
          ))}

          {shown && (
            <div className={`uchart-tip${edge}`} style={{ left: `${((active! + 0.5) / days.length) * 100}%` }} aria-hidden="true">
              <span className="uchart-tip-day">{longDayLabel(shown.date)}</span>
              <span>{shown.clips ? `${formatDuration(shown.seconds)} · ${shown.clips} ${shown.clips === 1 ? "clip" : "clips"}` : "Nothing made"}</span>
            </div>
          )}

          {max === 0 && <p className="uchart-empty faint">Nothing made in the last 30 days yet.</p>}
        </div>
        {/* Always present, so screen readers announce the first day the arrow keys pick. */}
        <p className="sr-only" role="status" aria-live="polite">
          {shown ? `${longDayLabel(shown.date)}: ${shown.clips ? `${formatDuration(shown.seconds)}, ${shown.clips} ${shown.clips === 1 ? "clip" : "clips"}` : "nothing made"}` : ""}
        </p>
      </div>

      <div className="uchart-x faint" aria-hidden="true">
        <span>{dayLabel(days[0].date)}</span>
        <span>{dayLabel(days[Math.floor(days.length / 2)].date)}</span>
        <span>Today</span>
      </div>

      <table className="sr-only">
        <caption>Audio made on each day with clips, last 30 days</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Audio</th>
            <th scope="col">Clips</th>
          </tr>
        </thead>
        <tbody>
          {busy.length === 0 ? (
            <tr>
              <td colSpan={3}>No clips in the last 30 days</td>
            </tr>
          ) : (
            busy.map((d) => (
              <tr key={d.date.getTime()}>
                <td>{longDayLabel(d.date)}</td>
                <td>{formatDuration(d.seconds)}</td>
                <td>{d.clips}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
