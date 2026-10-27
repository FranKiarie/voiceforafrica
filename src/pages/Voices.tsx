import { useState } from "react";
import { AppShell } from "../components/AppShell";
import { Drum, Shell } from "../components/Shell";
import { LIVE_ACCENTS, VOICES } from "../data";
import { setFlow } from "../flow";
import { API_MODE } from "../lib/api";
import { useVoiceSample } from "../lib/sample";
import { navigate } from "../router";
import "./Voices.css";

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
            <h1 className="vpage-title">Voices</h1>
            <p className="muted">{`${VOICES.length} voices in ${LIVE_ACCENTS.length} African accents. Play one, then use it for your script.`}</p>
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
            <h2 id={`accent-${a.id}`}>
              {a.label}
              <span className="faint">{` · ${voices.length} ${voices.length === 1 ? "voice" : "voices"}`}</span>
            </h2>
            <ul className="vgrid">
              {voices.map((v) => {
                const on = playing === v.id;
                return (
                  <li key={v.id} className="card vcard">
                    {v.sample ? (
                      <Drum size={44} playing={on} label={on ? `Pause ${v.name}` : `Play ${v.name}`} onClick={() => toggle(v.id)} />
                    ) : (
                      <span className="voice-nosample vcard-nosample" title="Sample coming soon" />
                    )}
                    <span className="vcard-text">
                      <span className="vcard-name">{v.name}</span>
                      <span className="faint">{`${v.gender} · ${v.style}`}</span>
                      {!v.sample && <span className="faint vcard-soon">Sample coming soon</span>}
                    </span>
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
