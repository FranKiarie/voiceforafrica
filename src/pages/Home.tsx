import { useState } from "react";
import { Drum, PatternDot, Shell } from "../components/Shell";
import { Link } from "../router";
import { DEFAULT_VOICE, LANGUAGES, LIVE_ACCENTS, PAYG_PRICE, VOICES, accentLabel } from "../data";
import { useVoiceSample } from "../lib/sample";
import { ICONS } from "../components/icons";
import "./Home.css";

const DOTS = ["#D0442A", "#E8A33C", "#3F57B8", "#2E9E6B"];

const USES = [
  { title: "Voice-overs", line: "For YouTube, TikTok, explainers and adverts online.", icon: ICONS.mic },
  { title: "Radio and TV ads", line: "Broadcast-ready spots, licensed for air on Pro and up.", icon: ICONS.radio },
  { title: "Phone menus", line: "“Press 1 for M-Pesa” prompts, in phone-ready 8 kHz audio.", icon: ICONS.phone },
  { title: "Audiobooks and courses", line: "Long scripts, ready later at a lower cost.", icon: ICONS.book },
  { title: "Podcasts and skits", line: "Two voices in one clip, for dialogue and drama.", icon: ICONS.chat },
  { title: "Announcements", line: "For shops, schools, churches and events, in the local language.", icon: ICONS.bell },
];


function LanguageRun({ hidden }: { hidden?: boolean }) {
  return (
    <div className="lang-run" aria-hidden={hidden || undefined}>
      {LANGUAGES.map((l, i) => (
        <span className="lang-item" key={l.code}>
          <span className="lang-name">
            <span className="lang-own" lang={l.code}>
              {l.own}
            </span>
            {l.en && <span className="lang-en faint">{l.en}</span>}
          </span>
          <svg width="10" height="10" aria-hidden="true" className="lang-dot">
            <circle cx="5" cy="5" r="5" fill={DOTS[i % DOTS.length]} />
          </svg>
        </span>
      ))}
    </div>
  );
}

export default function Home() {
  const [playingId, toggleSample] = useVoiceSample();
  const [accent, setAccent] = useState("ke");

  const voices = VOICES.filter((v) => v.accent === accent);
  const hero = VOICES.find((v) => v.id === DEFAULT_VOICE) ?? VOICES[0];
  const heroPlaying = playingId === hero.id;

  return (
    <Shell>
      <section className="home-hero">
        <p className="home-eyebrow">VOICE FOR AFRICA</p>
        <h1 className="home-title">
          African voices,
          <br />
          <span className="hand">given a platform.</span>
        </h1>
        <p className="home-lede muted">Voice-overs in your accent. Paste a script, hear 45 seconds free, pay with M-Pesa or card.</p>
        <Link className="btn home-cta" href="/studio">
          Paste your script
        </Link>
        <p className="home-price faint">{`${PAYG_PRICE}, or plans from $15`}</p>
        <div className="home-sample">
          <Drum
            size={96}
            playing={heroPlaying}
            label={heroPlaying ? `Pause ${hero.name}` : `Play ${hero.name}`}
            onClick={() => toggleSample(hero.id)}
          />
          <p className="faint home-sample-caption">{`Hear ${hero.name} · ${accentLabel(hero.accent)} accent`}</p>
        </div>
      </section>

      <section className="home-langs" aria-label="Languages we speak">
        <div className="lang-track">
          <LanguageRun />
          <LanguageRun hidden />
        </div>
      </section>
      <p className="home-lang-note faint">
        {`${LANGUAGES.length} languages. Pay as you go uses one per clip; plans add more.`}
      </p>

      <section className="home-make" aria-labelledby="make">
        <h2 id="make" className="center">
          What you can make
        </h2>
        <div className="make-grid">
          {USES.map((u) => (
            <div className="make-item" key={u.title}>
              <span className="make-badge" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d={u.icon}
                    fill="none"
                    stroke="#C2410C"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div className="make-text">
                <h3>{u.title}</h3>
                <p className="muted">{u.line}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="voices" className="home-voices" aria-labelledby="voices-title">
        <div className="voices-head">
          <h2 id="voices-title">Voices</h2>
          <label className="voices-filter faint">
            Accent
            <select value={accent} onChange={(e) => setAccent(e.target.value)}>
              {LIVE_ACCENTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <ul className="voice-list">
          {voices.map((v) => {
            const playing = playingId === v.id;
            return (
              <li className="voice-row" key={v.id}>
                {v.sample ? (
                  <Drum
                    size={44}
                    playing={playing}
                    label={playing ? `Pause ${v.name}` : `Play ${v.name}`}
                    onClick={() => toggleSample(v.id)}
                  />
                ) : (
                  <span className="voice-nosample" aria-hidden="true" />
                )}
                <div className="voice-text">
                  <span className="voice-name">{v.name}</span>
                  <span className="voice-meta faint">{v.sample ? v.meta : `${v.meta} · sample soon`}</span>
                </div>
                <PatternDot pattern="beads" size={22} />
              </li>
            );
          })}
        </ul>

      </section>
    </Shell>
  );
}
