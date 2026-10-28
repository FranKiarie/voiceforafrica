import { useEffect, useRef } from "react";
import { BeadWave, Cycle, InkUnderline, RiseWords } from "../components/Motion";
import { PatternStrip, Shell } from "../components/Shell";
import { Link } from "../router";
import { LANGUAGES, LIVE_ACCENTS, VOICES } from "../data";
import "./Dubbing.css";

// Enterprise dubbing: how it works and how to start. No prices on this page:
// every project is quoted on its own.

// The same inbox the Enterprise card on /pricing uses.
const CONTACT_EMAIL = "support@mikaka.io";
const CONTACT_HREF = `mailto:${CONTACT_EMAIL}?subject=Dubbing%20enquiry`;

const STEPS: { title: string; line: string }[] = [
  {
    title: "Brief",
    line: "Send us the source video or audio, scripts if you have them, and the languages and audiences you want to reach. We can sign an NDA first.",
  },
  {
    title: "Transcribe and time",
    line: "We transcribe the original with timestamps and speaker labels.",
  },
  {
    title: "Translate and adapt",
    line: "We translate the script and adapt it for each market, so it fits the timing and sounds natural. Your team, or a reviewer you nominate, approves it.",
  },
  {
    title: "Cast",
    line: "Pick voices from our African library for each character or narrator, or ask us to design a new voice.",
  },
  {
    title: "Voice and fit",
    line: "We render the voice track and fit it to the original timing. Send your music and effects as separate stems and we mix them in.",
  },
  {
    title: "Review",
    line: "Ask for changes, round by round, until you sign off.",
  },
  {
    title: "Deliver",
    line: "You get the final mix, separate voice stems in WAV or MP3, subtitles in SRT or VTT, and a licence for each delivery.",
  },
];

const LIMITS = [
  "This is voice-over dubbing, timed to the original. It is not lip-sync: the new voice follows the timing of each line, not the mouths on screen.",
  "Turnaround is agreed per project, once we have seen the material and know how many languages you need.",
];

const DELIVERABLES = [
  "The final mix, ready to publish",
  "Separate voice stems, in WAV or MP3",
  "Subtitles in SRT and VTT",
  "The approved script for each language",
  "A licence for each delivery",
];

const SECURITY = [
  "Your source files and scripts are kept in private storage.",
  "We delete them after delivery if you ask.",
  "We will sign an NDA before you send anything.",
];

// "Welcome", in languages we voice today (codes from LANGUAGES in data.ts). The hero
// cycles through them. Zulu and Yoruba are left out until we can voice them.
const WELCOMES: { code: string; text: string; rtl?: boolean }[] = [
  { code: "sw", text: "Karibu" },
  { code: "ha", text: "Barka da zuwa" },
  { code: "am", text: "እንኳን ደህና መጡ" },
  { code: "ak", text: "Akwaaba" },
  { code: "rw", text: "Murakaza neza" },
  { code: "fr", text: "Bienvenue" },
  { code: "ar", text: "أهلاً وسهلاً", rtl: true },
];

const HELLOS = WELCOMES.flatMap((w) => {
  const lang = LANGUAGES.find((l) => l.code === w.code);
  return lang ? [{ ...w, name: lang.en ?? lang.own }] : [];
});

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// Centre of a step's number circle, from the top of its row (see .dub-num in Dubbing.css).
const NUM_CENTRE = 34;

/**
 * "How it works": a gold line draws down the numbers as the steps scroll up past
 * the lower part of the screen, and each number pops in as the line reaches it.
 * The line only ever grows, so scrolling back up leaves it drawn.
 */
function useStepLine() {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    const steps = Array.from(list.querySelectorAll<HTMLElement>(".dub-step"));
    if (reduced()) {
      steps.forEach((s) => {
        s.style.setProperty("--seg", "1");
        s.dataset.on = "";
      });
      return;
    }
    const drawn = steps.map(() => 0);
    let frame = 0;
    const update = () => {
      frame = 0;
      const reach = window.innerHeight * 0.72;
      steps.forEach((s, i) => {
        const r = s.getBoundingClientRect();
        const centre = r.top + NUM_CENTRE;
        if (reach >= centre && s.dataset.on === undefined) s.dataset.on = "";
        if (i === steps.length - 1 || !r.height) return;
        const p = Math.max(0, Math.min(1, (reach - centre) / r.height));
        if (p > drawn[i]) {
          drawn[i] = p;
          s.style.setProperty("--seg", p.toFixed(3));
        }
      });
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    // Capture, so a scroll inside the signed-in frame counts as well as the window's.
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return ref;
}

/** Chips rise in, rippling 45 ms apart, when the list comes into view. */
function useChipsIn() {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    const chips = Array.from(list.querySelectorAll<HTMLElement>(".dub-chip"));
    const show = () =>
      chips.forEach((c, i) => {
        c.style.setProperty("--chip-delay", `${Math.min(i * 45, 600)}ms`);
        c.dataset.rise = "in";
      });
    if (reduced() || typeof IntersectionObserver === "undefined") {
      show();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting || e.boundingClientRect.bottom < 0)) {
          io.disconnect();
          show();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(list);
    return () => io.disconnect();
  }, []);
  return ref;
}

/** "a, b and c" */
function listOf(items: string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export default function Dubbing() {
  const accents = LIVE_ACCENTS.map((a) => ({ ...a, voices: VOICES.filter((v) => v.accent === a.id).length }));
  const languages = listOf(LANGUAGES.map((l) => l.en ?? l.own));
  const stepsRef = useStepLine();
  const chipsRef = useChipsIn();

  return (
    <Shell>
      <div className="dub">
        <section className="dub-hero" aria-labelledby="dub-title">
          <p className="dub-eyebrow">ENTERPRISE</p>
          <h1 id="dub-title" className="dub-title">
            <InkUnderline delay={520}>
              <RiseWords text="Dubbing" />
            </InkUnderline>{" "}
            <RiseWords text="for enterprises" delay={70} />
          </h1>
          <div className="dub-hello" aria-hidden="true">
            <BeadWave beads={7} className="dub-hello-wave" />
            <Cycle interval={2800}>
              {HELLOS.map((h) => (
                <span key={h.code} className="dub-hello-item">
                  <span className="dub-hello-word" lang={h.code} dir={h.rtl ? "rtl" : undefined}>
                    {h.text}
                  </span>
                  <span className="dub-hello-lang">{h.name}</span>
                </span>
              ))}
            </Cycle>
          </div>
          <p className="dub-lede muted">Your videos, ads, training and broadcast content, voiced in African languages and accents.</p>
          <p className="dub-for faint">
            For broadcasters, brands and agencies, NGOs and public-health campaigns, e-learning teams and government.
          </p>
        </section>

        <section className="dub-block" aria-labelledby="dub-how">
          <h2 id="dub-how">How it works</h2>
          <ol ref={stepsRef} className="dub-steps" role="list">
            {STEPS.map((s, i) => (
              <li className="dub-step" key={s.title}>
                <span className="dub-num">{i + 1}</span>
                <div className="dub-step-text">
                  <h3>{s.title}</h3>
                  <p className="muted">{s.line}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="dub-note card" aria-labelledby="dub-limits">
          <PatternStrip pattern="kitenge" />
          <div className="dub-note-body">
            <h2 id="dub-limits">Good to know</h2>
            <ul className="dub-list" role="list">
              {LIMITS.map((t) => (
                <li key={t} className="muted">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <div className="dub-pair">
          <section className="dub-block" aria-labelledby="dub-get">
            <h2 id="dub-get">What you get</h2>
            <ul className="dub-list" role="list">
              {DELIVERABLES.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>

          <section className="dub-block" aria-labelledby="dub-safe">
            <h2 id="dub-safe">Your files stay private</h2>
            <ul className="dub-list" role="list">
              {SECURITY.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </section>
        </div>

        <section className="dub-block" aria-labelledby="dub-voices">
          <h2 id="dub-voices">Languages and voices</h2>
          <p className="muted">
            {`${VOICES.length} voices with accents from ${accents.length} African countries, for every narrator and character.`}
          </p>
          <ul ref={chipsRef} className="dub-chips" role="list" aria-label="Accents and how many voices each has">
            {accents.map((a) => (
              <li className="dub-chip" key={a.id}>
                {a.label}
                <span className="faint">{a.voices}</span>
              </li>
            ))}
          </ul>
          <p className="muted">{`Voiced in ${LANGUAGES.length} languages: ${languages}.`}</p>
          <p className="muted">Need a voice that isn't here? Ask us to design one.</p>
        </section>

        <section className="dub-talk" aria-labelledby="dub-price">
          <h2 id="dub-price">Pricing</h2>
          <p className="muted">Pricing is agreed per project, based on minutes, languages and review rounds. Talk to us.</p>
          <a className="btn dub-cta" href={CONTACT_HREF}>
            Talk to us about dubbing
          </a>
          <p className="faint dub-mail">
            Or write to <a href={CONTACT_HREF}>{CONTACT_EMAIL}</a>
          </p>
          <nav className="dub-more" aria-label="More from Mikaka Voice">
            <Link href="/#voices">Hear the voices</Link>
            <Link href="/transcribe">Try transcription</Link>
          </nav>
        </section>
      </div>
    </Shell>
  );
}
