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

/** "a, b and c" */
function listOf(items: string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export default function Dubbing() {
  const accents = LIVE_ACCENTS.map((a) => ({ ...a, voices: VOICES.filter((v) => v.accent === a.id).length }));
  const languages = listOf(LANGUAGES.map((l) => l.en ?? l.own));

  return (
    <Shell>
      <div className="dub">
        <section className="dub-hero" aria-labelledby="dub-title">
          <p className="dub-eyebrow">ENTERPRISE</p>
          <h1 id="dub-title" className="dub-title">
            Dubbing for enterprises
          </h1>
          <p className="dub-lede muted">Your videos, ads, training and broadcast content, voiced in African languages and accents.</p>
          <p className="dub-for faint">
            For broadcasters, brands and agencies, NGOs and public-health campaigns, e-learning teams and government.
          </p>
        </section>

        <section className="dub-block" aria-labelledby="dub-how">
          <h2 id="dub-how">How it works</h2>
          <ol className="dub-steps" role="list">
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
          <ul className="dub-chips" role="list" aria-label="Accents and how many voices each has">
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
