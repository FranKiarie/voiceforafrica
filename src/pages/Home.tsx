import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Drum, PatternDot, PatternStrip, Shell } from "../components/Shell";
import { BeadWave, CountUp, InkUnderline, RiseWords, useInView } from "../components/Motion";
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
  { title: "Voice-overs", line: "For YouTube, TikTok, explainers and adverts online.", icon: ICONS.mic },
  { title: "Radio and TV ads", line: "Broadcast-ready spots, licensed for air on Pro and up.", icon: ICONS.radio },
  { title: "Phone menus", line: "“Press 1 for M-Pesa” prompts, in phone-ready 8 kHz audio.", icon: ICONS.phone },
  { title: "Audiobooks and courses", line: "Long scripts, ready later at a lower cost.", icon: ICONS.book },
  { title: "Podcasts and skits", line: "Two voices in one clip, for dialogue and drama.", icon: ICONS.chat },
  { title: "Announcements", line: "For shops, schools, churches and events, in the local language.", icon: ICONS.bell },
];

const STATS = [
  { value: VOICES.length, label: "voices" },
  { value: LIVE_ACCENTS.length, label: "accents" },
  { value: LANGUAGES.length, label: "languages" },
];

// The stage says hello around the continent. Each greeting is in a language we
// speak (LANGUAGES) and is paired with a voice from that country that has a sample.
type GreetingSeed = { text: string; lang: string; meaning: string; say?: string; dir?: "rtl"; voice: string };
type Greeting = Omit<GreetingSeed, "voice"> & { voice: Voice; language: string };

const GREETING_SEEDS: GreetingSeed[] = [
  { text: "Habari!", lang: "sw", meaning: "Hello", voice: "wanjiru" },
  { text: "Sannu!", lang: "ha", meaning: "Hello", voice: "musa" },
  { text: "Dumela!", lang: "st", meaning: "Hello", voice: "lerato" },
  { text: "ሰላም", lang: "am", meaning: "Hello", say: "selam", voice: "selam" },
  { text: "Bonjour !", lang: "fr", meaning: "Hello", voice: "awa" },
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
 * The hero's voice stage: a greeting bubble that moves around the continent, a bead
 * wave that breathes (and speaks while the sample plays) and a drum that plays the
 * voice shown. The bubble rests while that voice plays, while the drum is hovered or
 * keyboard-focused, and while the stage is off screen. Reduced motion: Wanjiru only.
 */
function VoiceStage({ playingId, toggle }: { playingId: string | null; toggle: (id: string) => void }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const [onScreen, setOnScreen] = useState(true);
  const [gi, setGi] = useState(0);
  const [hold, setHold] = useState(false);
  const first = useRef(true);
  const [still] = useState(reducedMotion);

  const g: Greeting | undefined = GREETINGS[gi % Math.max(1, GREETINGS.length)];
  const voice = g?.voice ?? VOICES[0];
  const playing = playingId === voice.id;
  const paused = playing || hold || !onScreen;

  // Live (not sticky) visibility, so the greetings rest while scrolled away.
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => setOnScreen(entries.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);

  useEffect(() => {
    if (!seen || paused || still || GREETINGS.length < 2) return;
    let id = 0;
    const tick = () => {
      if (document.visibilityState !== "visible") {
        id = window.setTimeout(tick, CYCLE_MS);
        return;
      }
      first.current = false;
      setGi((n) => (n + 1) % GREETINGS.length);
    };
    // The first greeting stays a little longer while the stage settles in.
    id = window.setTimeout(tick, first.current ? CYCLE_MS + 1000 : CYCLE_MS);
    return () => window.clearTimeout(id);
  }, [gi, seen, paused, still]);

  const holdOnFocus = (el: Element) => {
    try {
      if (el.matches(":focus-visible")) setHold(true);
    } catch {
      // Older browsers without :focus-visible: the greetings carry on.
    }
  };

  return (
    <div ref={ref} className={`hs${seen ? " is-in" : ""}`}>
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

          <div className="hs-dots" aria-hidden="true">
            {GREETINGS.map((x, k) => (
              <span key={x.voice.id} className={k === gi ? "on" : undefined} style={vars({ "--c": DOTS[k % DOTS.length] })} />
            ))}
          </div>

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
            <span className={`hs-drum${playing ? " is-playing" : ""}`}>
              <span className="hs-halo" aria-hidden="true" />
              <Drum
                size={72}
                playing={playing}
                label={playing ? `Pause ${voice.name}` : `Play ${voice.name}`}
                onClick={() => toggle(voice.id)}
              />
            </span>
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

      <span className="hs-chip hs-chip-a" style={vars({ "--d": "1150ms" })}>
        <span className="hs-chip-in float-soft">
          <span className="hs-chip-dot" style={vars({ "--c": "var(--gold)" })} aria-hidden="true" />
          {`${PREVIEW_SECONDS} s free preview`}
        </span>
      </span>
      <span className="hs-chip hs-chip-b" style={vars({ "--d": "1300ms" })}>
        <span className="hs-chip-in float-soft float-late">
          <span className="hs-chip-dot" style={vars({ "--c": "var(--green)" })} aria-hidden="true" />
          M-Pesa or card
        </span>
      </span>
      <span className="hs-chip hs-chip-c" style={vars({ "--d": "1450ms" })}>
        <span className="hs-chip-in float-soft" style={{ animationDelay: "-1.6s" }}>
          <span className="hs-chip-dot" style={vars({ "--c": "var(--indigo)" })} aria-hidden="true" />
          Try it with no account
        </span>
      </span>
    </div>
  );
}

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
  // After the first accent change the global reveal (reveal.ts) ripples the new rows in.
  const [filtered, setFiltered] = useState(false);
  const [makeRef, makeSeen] = useInView<HTMLDivElement>("0px 0px -8% 0px");
  const [listRef, listSeen] = useInView<HTMLDivElement>("0px 0px -6% 0px");
  // The counters start once the stats row has faded in, so the count is seen.
  const [statsGo, setStatsGo] = useState(reducedMotion);

  useEffect(() => {
    if (statsGo) return;
    const id = window.setTimeout(() => setStatsGo(true), 950);
    return () => window.clearTimeout(id);
  }, [statsGo]);

  const voices = VOICES.filter((v) => v.accent === accent);

  return (
    <Shell>
      <section className="home-hero">
        <div className="home-copy">
          <p className="home-eyebrow">
            <span className="home-eyebrow-dots" aria-hidden="true">
              {DOTS.map((c, i) => (
                <span key={c} style={vars({ "--c": c, "--i": String(i) })} />
              ))}
            </span>
            VOICE FOR AFRICA
          </p>
          <h1 className="home-title">
            <RiseWords text="African voices," delay={120} step={90} />{" "}
            <br />
            <span className="hand">
              <InkUnderline delay={1080}>
                <RiseWords text="given a platform." delay={340} step={100} />
              </InkUnderline>
            </span>
          </h1>
          <p className="home-lede muted">Voice-overs in your accent. Paste a script, hear 45 seconds free, pay with M-Pesa or card.</p>
          <div className="home-cta-row">
            <Link className="btn home-cta" href="/studio">
              Paste your script
            </Link>
            <p className="home-price faint">{`${PAYG_PRICE}, or plans from $15`}</p>
          </div>
          <div className="home-stats">
            {STATS.map((s) => (
              <p className="home-stat" key={s.label}>
                <span className="sr-only">{`${s.value} ${s.label}`}</span>
                <span className="home-stat-show" aria-hidden="true">
                  {statsGo ? <CountUp value={s.value} className="home-stat-n" /> : <span className="home-stat-n">0</span>}
                  <span className="home-stat-l faint">{s.label}</span>
                </span>
              </p>
            ))}
          </div>
        </div>

        <VoiceStage playingId={playingId} toggle={toggleSample} />
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
        <div ref={makeRef} className={`make-grid${makeSeen ? " is-in" : ""}`}>
          {USES.map((u, i) => (
            <div className="make-item" key={u.title} style={vars({ "--d": `${i * 90}ms` })}>
              <span className="make-badge" aria-hidden="true">
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    className="make-ink"
                    d={u.icon}
                    pathLength={1}
                    fill="none"
                    stroke="currentColor"
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
            <select
              value={accent}
              onChange={(e) => {
                setAccent(e.target.value);
                setFiltered(true);
              }}
            >
              {LIVE_ACCENTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div ref={listRef} className={`home-list${listSeen ? " is-in" : ""}${filtered ? " is-filtered" : ""}`}>
          <ul className="voice-list" key={accent}>
            {voices.map((v, i) => {
              const playing = playingId === v.id;
              return (
                <li className="voice-row" key={v.id} style={vars({ "--d": `${Math.min(i, 10) * 45}ms` })}>
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
                  <span className="home-row-end" aria-hidden="true">
                    {playing ? <BeadWave beads={6} speaking className="home-row-wave" /> : <PatternDot pattern="beads" size={22} />}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </Shell>
  );
}
