import { useState } from "react";
import { Drum, PatternDot, Shell } from "../components/Shell";
import { Link } from "../router";
import { COMING_SOON, DEFAULT_VOICE, LANGUAGES, VOICES } from "../data";
import { useVoiceSample } from "../lib/sample";
import "./Home.css";

const DOTS = ["#D0442A", "#E8A33C", "#3F57B8", "#2E9E6B"];

const ICONS = {
  mic: "M12 3 a3 3 0 0 1 3 3 v6 a3 3 0 0 1 -6 0 v-6 a3 3 0 0 1 3 -3 Z M5 11 a7 7 0 0 0 14 0 M12 18 v3",
  radio: "M4 9 h16 v11 h-16 Z M7 9 L17 4 M8 14.5 a1.5 1.5 0 1 0 0.01 0 M13 13 h4 M13 16 h4",
  phone: "M5 4 h4 l2 5 -2.5 1.5 a11 11 0 0 0 5 5 l1.5 -2.5 5 2 v4 a2 2 0 0 1 -2 2 A16 16 0 0 1 3 6 a2 2 0 0 1 2 -2 Z",
  book: "M4 5 a2 2 0 0 1 2 -2 h13 v16 h-13 a2 2 0 0 0 -2 2 Z M4 19 v2 M8 7 h7",
  chat: "M4 5 h11 v8 h-7 l-4 3 Z M9 16 v2 h7 l4 3 v-11 h-3",
  bell: "M6 16 v-5 a6 6 0 0 1 12 0 v5 l2 2 h-16 Z M10 20 a2 2 0 0 0 4 0",
};

const USES = [
  { title: "Voice-overs", line: "For YouTube, TikTok, explainers and adverts online.", icon: ICONS.mic },
  { title: "Radio and TV ads", line: "Broadcast-ready spots, licensed for air on Pro and up.", icon: ICONS.radio },
  { title: "Phone menus", line: "“Press 1 for M-Pesa” prompts, in phone-ready 8 kHz audio.", icon: ICONS.phone },
  { title: "Audiobooks and courses", line: "Long scripts, ready later at a lower cost.", icon: ICONS.book },
  { title: "Podcasts and skits", line: "Two voices in one clip, for dialogue and drama.", icon: ICONS.chat },
  { title: "Announcements", line: "For shops, schools, churches and events, in the local language.", icon: ICONS.bell },
];

const VOICE_FILTERS = ["All", "Female", "Male"];

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
  const [who, setWho] = useState("All");

  const voices = who === "All" ? VOICES : VOICES.filter((v) => v.gender === who);
  const hero = VOICES.find((v) => v.id === DEFAULT_VOICE) ?? VOICES[0];
  const heroPlaying = playingId === hero.id;

  return (
    <Shell>
      <section className="home-hero">
        <p className="home-eyebrow">KARIBU</p>
        <h1 className="home-title">
          Voice-overs
          <br />
          <span className="hand">in your accent.</span>
        </h1>
        <p className="home-lede muted">Paste a script, hear 45 seconds free, pay with M-Pesa.</p>
        <Link className="btn home-cta" href="/studio">
          Paste your script
        </Link>
        <p className="home-price faint">KES 195 a minute, or plans from $15</p>
        <div className="home-sample">
          <Drum
            size={96}
            playing={heroPlaying}
            label={heroPlaying ? `Pause ${hero.name}` : `Play ${hero.name}`}
            onClick={() => toggleSample(hero.id)}
          />
          <p className="faint home-sample-caption">{`Hear ${hero.name} · Kenyan accent`}</p>
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
            Show
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              {VOICE_FILTERS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
        </div>

        <ul className="voice-list">
          {voices.map((v) => {
            const playing = playingId === v.id;
            return (
              <li className="voice-row" key={v.id}>
                <Drum
                  size={44}
                  playing={playing}
                  label={playing ? `Pause ${v.name}` : `Play ${v.name}`}
                  onClick={() => toggleSample(v.id)}
                />
                <div className="voice-text">
                  <span className="voice-name">{v.name}</span>
                  <span className="voice-meta faint">{v.meta}</span>
                </div>
                <PatternDot pattern="beads" size={22} />
              </li>
            );
          })}
        </ul>

        <div className="voices-soon faint">
          <span>Coming after our voice check:</span>
          {COMING_SOON.map((s) => (
            <span className="soon-item" key={s.country}>
              <PatternDot pattern={s.pattern} size={14} />
              {s.country}
            </span>
          ))}
        </div>
      </section>
    </Shell>
  );
}
