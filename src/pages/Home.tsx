import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Drum, PatternDot, PatternStrip, Shell } from "../components/Shell";
import { BeadWave, InkUnderline } from "../components/Motion";
import { Link } from "../router";
import { LANGUAGES, LIVE_ACCENTS, PAYG_PRICE, PREVIEW_SECONDS, VOICES, accentLabel, type Voice } from "../data";
import { useVoiceSample } from "../lib/sample";
import { ICONS } from "../components/icons";
import "./Home.css";

const DOTS = ["var(--red)", "var(--gold)", "var(--indigo)", "var(--green)"];

/** Custom properties for inline styles (React's CSSProperties has no index for them). */
const vars = (o: Record<string, string>) => o as CSSProperties;

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const USES = [
  { title: "Voice-overs", line: "YouTube, TikTok and online ads.", icon: ICONS.mic },
  { title: "Radio and TV ads", line: "Broadcast licence on Pro and up.", icon: ICONS.radio },
  { title: "Phone menus", line: "“Press 1” prompts in 8 kHz audio.", icon: ICONS.phone },
  { title: "Audiobooks and courses", line: "Long scripts, ready later for less.", icon: ICONS.book },
];

const STATS = [
  { value: VOICES.length, label: "voices" },
  { value: LIVE_ACCENTS.length, label: "accents" },
  { value: LANGUAGES.length, label: "languages" },
];

// The stage says hello around the continent. Each greeting is in a language we
// speak (LANGUAGES) and is paired with a voice from that country that has a sample.
const NON_LATIN = /[^\u0000-\u024F]/;

type GreetingSeed = { text: string; lang: string; meaning: string; say?: string; dir?: "rtl"; voice: string };
type Greeting = Omit<GreetingSeed, "voice"> & { voice: Voice; language: string };

const GREETING_SEEDS: GreetingSeed[] = [
  { text: "Habari!", lang: "sw", meaning: "Hello", voice: "wanjiru" },
  { text: "Sannu!", lang: "ha", meaning: "Hello", voice: "musa" },
  { text: "Dumela!", lang: "st", meaning: "Hello", voice: "lerato" },
  { text: "ሰላም", lang: "am", meaning: "Hello", say: "selam", voice: "selam" },
  { text: "Bonjour !", lang: "fr", meaning: "Hello", voice: "awa" },
  { text: "Akwaaba!", lang: "ak", meaning: "Welcome", voice: "kwame" },
  { text: "Oli otya?", lang: "lg", meaning: "How are you?", voice: "nakato" },
  { text: "أهلاً", lang: "ar", meaning: "Hello", say: "ahlan", dir: "rtl", voice: "nour" },
  { text: "Muraho!", lang: "rw", meaning: "Hello", voice: "uwase" },
  { text: "Mbote!", lang: "ln", meaning: "Hello", voice: "bijou" },
];

const GREETINGS: Greeting[] = GREETING_SEEDS.flatMap((g) => {
  const voice = VOICES.find((v) => v.id === g.voice && v.sample);
  const language = LANGUAGES.find((l) => l.code === g.lang);
  return voice && language ? [{ ...g, voice, language: language.en ?? language.own }] : [];
});

const CYCLE_MS = 2800;

/**
 * The hero's voice stage: a greeting bubble that crossfades around the continent, a
 * bead wave that speaks while the sample plays, and a drum that plays the voice shown.
 * The greetings rest while that voice plays, while the drum is hovered or
 * keyboard-focused, and while the stage is off screen. Reduced motion: Wanjiru only.
 */
function VoiceStage({ playingId, toggle }: { playingId: string | null; toggle: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [gi, setGi] = useState(0);
  const [hold, setHold] = useState(false);
  const [still] = useState(reducedMotion);

  const g: Greeting | undefined = GREETINGS[gi % Math.max(1, GREETINGS.length)];
  const voice = g?.voice ?? VOICES[0];
  const playing = playingId === voice.id;
  const paused = playing || hold || !onScreen;

  // Live visibility, so the greetings rest while scrolled away.
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (paused || still || GREETINGS.length < 2) return;
    let id = 0;
    const tick = () => {
      if (document.visibilityState !== "visible") {
        id = window.setTimeout(tick, CYCLE_MS);
        return;
      }
      setGi((n) => (n + 1) % GREETINGS.length);
    };
    id = window.setTimeout(tick, CYCLE_MS);
    return () => window.clearTimeout(id);
  }, [gi, paused, still]);

  const holdOnFocus = (el: Element) => {
    try {
      if (el.matches(":focus-visible")) setHold(true);
    } catch {
      // Older browsers without :focus-visible: the greetings carry on.
    }
  };

  return (
    <div ref={ref} className="hs">
      <div className="hs-deck" aria-hidden="true" />
      <div className="hs-card">
        <PatternStrip pattern="beads" height={12} />
        <div className="hs-body">
          {g && (
            <div className="hs-bubble">
              <span className="cycle hs-cycle" aria-live="off">
                <span key={gi} className="cycle-item hs-greet">
                  <span className="hs-word" lang={g.lang} dir={g.dir}>
                    {g.text}
                  </span>
                  <span className="hs-mean">{`“${g.meaning}” in ${g.language}${g.say ? ` · ${g.say}` : ""}`}</span>
                </span>
              </span>
            </div>
          )}

          <BeadWave beads={28} speaking={playing} className="hs-wave" />

          <div
            className="hs-play"
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse") setHold(true);
            }}
            onPointerLeave={(e) => {
              if (e.pointerType === "mouse") setHold(false);
            }}
            onFocus={(e) => holdOnFocus(e.target)}
            onBlur={() => setHold(false)}
          >
            <Drum
              size={72}
              playing={playing}
              label={playing ? `Pause ${voice.name}` : `Play ${voice.name}`}
              onClick={() => toggle(voice.id)}
            />
            <p className="hs-caption">
              <span key={gi} className="hs-caption-in">
                <span className="hs-name">{`Hear ${voice.name}`}</span>
                <span className="sr-only"> · </span>
                <span className="hs-accent faint">{`${accentLabel(voice.accent)} accent · ${voice.style}`}</span>
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [playingId, toggleSample] = useVoiceSample();
  const [accent, setAccent] = useState("ke");

  const voices = VOICES.filter((v) => v.accent === accent);

  return (
    <Shell>
      <section className="home-hero">
        <div className="home-copy">
          <p className="home-eyebrow">
            <span className="home-eyebrow-dots" aria-hidden="true">
              {DOTS.map((c) => (
                <span key={c} style={vars({ "--c": c })} />
              ))}
            </span>
            VOICE FOR AFRICA
          </p>
          <h1 className="home-title">
            African voices,{" "}
            <br />
            <span className="hand">
              <InkUnderline>given a platform.</InkUnderline>
            </span>
          </h1>
          <p className="home-lede muted">{`Voice-overs in your accent. Hear ${PREVIEW_SECONDS} seconds free.`}</p>
          <div className="home-cta-row">
            <Link className="btn home-cta" href="/studio">
              Paste your script
            </Link>
            <p className="home-price faint">{`${PAYG_PRICE} or plans from $15, by M-Pesa or card`}</p>
          </div>
          <div className="home-stats">
            {STATS.map((s) => (
              <p className="home-stat" key={s.label}>
                <span className="home-stat-n">{s.value}</span>
                <span className="home-stat-l faint">{s.label}</span>
              </p>
            ))}
          </div>
        </div>

        <VoiceStage playingId={playingId} toggle={toggleSample} />
      </section>

      <section className="home-langs" aria-label="Languages we speak">
        <ul className="lang-list" role="list">
          {LANGUAGES.map((l, i) => (
            <li key={l.code} lang={l.code} title={l.en} style={vars({ "--c": DOTS[i % DOTS.length] })}>
              {l.own}
              {/* Names in another script also carry their English name, so everyone can read them. */}
              {l.en && NON_LATIN.test(l.own) && (
                <span className="lang-en" lang="en">
                  {l.en}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="home-make" aria-labelledby="make">
        <h2 id="make" className="center">
          What you can make
        </h2>
        <div className="make-grid">
          {USES.map((u) => (
            <div className="make-item" key={u.title}>
              <span className="make-badge" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                  <path d={u.icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

        <ul className="voice-list" key={accent}>
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
                  {/* The accent is the one picked above, so the row leaves it out. */}
                  <span className="voice-meta faint">{`${v.gender} · ${v.style}${v.sample ? "" : " · sample soon"}`}</span>
                </div>
                <span className="home-row-end" aria-hidden="true">
                  {playing ? <BeadWave beads={6} speaking className="home-row-wave" /> : <PatternDot pattern="beads" size={22} />}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </Shell>
  );
}
