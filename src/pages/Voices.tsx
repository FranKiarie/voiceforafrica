import { useState } from "react";
import { AppShell } from "../components/AppShell";
import { BeadWave, CountUp, RiseWords, useInView } from "../components/Motion";
import { Drum, PatternStrip, Shell } from "../components/Shell";
import { LIVE_ACCENTS, VOICES } from "../data";
import { setFlow } from "../flow";
import { API_MODE } from "../lib/api";
import { useVoiceSample } from "../lib/sample";
import { navigate } from "../router";
import "./Voices.css";

/** An accent's heading, sliding in from the left as its section comes into view. */
function GroupTitle({ id, label, count }: { id: string; label: string; count: number }) {
  // No inset: it moves together with the section's own scroll reveal.
  const [ref, seen] = useInView<HTMLHeadingElement>("0px");
  return (
    <h2 ref={ref} id={id} className={`vgroup-title${seen ? " is-in" : ""}`}>
      {label}
      <span className="faint">{` · ${count} ${count === 1 ? "voice" : "voices"}`}</span>
    </h2>
  );
}

/** Every voice, grouped by accent, with its sample and a button to use it. */
export default function Voices() {
  const [accent, setAccent] = useState("all");
  const [playing, toggle] = useVoiceSample();
  // Shell already gives signed-in visitors the sidebar; the demo has no session, so it asks for it.
  const Frame = API_MODE === "demo" ? AppShell : Shell;

  const groups = LIVE_ACCENTS.filter((a) => accent === "all" || a.id === accent).map((a) => ({
    accent: a,
    voices: VOICES.filter((v) => v.accent === a.id),
  }));

  const use = (voiceId: string) => {
    setFlow({ voiceId });
    navigate("/studio");
  };

  return (
    <Frame>
      <div className="vpage">
        <header className="vpage-head">
          <div>
            <h1 className="vpage-title">
              <RiseWords text="Voices" />
            </h1>
            <div className="vpage-strip" aria-hidden="true">
              <PatternStrip pattern="beads" />
            </div>
            <p className="muted">
              {/* The count rolls up on screen; screen readers get the number once. */}
              <span className="vpage-count" aria-hidden="true" style={{ minWidth: `${String(VOICES.length).length}ch` }}>
                <CountUp value={VOICES.length} />
              </span>
              <span className="sr-only">{VOICES.length}</span>
              {` voices in ${LIVE_ACCENTS.length} African accents. Play one, then use it for your script.`}
            </p>
          </div>
          <label className="field vpage-filter">
            Accent
            <select value={accent} onChange={(e) => setAccent(e.target.value)}>
              <option value="all">All accents</option>
              {LIVE_ACCENTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </header>

        {groups.map(({ accent: a, voices }) => (
          <section key={a.id} className="vgroup" aria-labelledby={`accent-${a.id}`}>
            <GroupTitle id={`accent-${a.id}`} label={a.label} count={voices.length} />
            <ul className="vgrid">
              {voices.map((v) => {
                const on = playing === v.id;
                return (
                  <li key={v.id} className={`card vcard${on ? " is-playing" : ""}`}>
                    {v.sample ? (
                      <Drum size={44} playing={on} label={on ? `Pause ${v.name}` : `Play ${v.name}`} onClick={() => toggle(v.id)} />
                    ) : (
                      <span className="voice-nosample vcard-nosample" title="Sample coming soon" />
                    )}
                    <div className="vcard-text">
                      <div className="vcard-name">
                        {v.name}
                        {on && <BeadWave beads={7} speaking className="vcard-wave" />}
                      </div>
                      <span className="faint">{`${v.gender} · ${v.style}`}</span>
                      {!v.sample && <span className="faint vcard-soon">Sample coming soon</span>}
                    </div>
                    <button type="button" className="vcard-use" onClick={() => use(v.id)} aria-label={`Use ${v.name}`}>
                      Use
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Frame>
  );
}
