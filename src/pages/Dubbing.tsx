import { BeadWave, Cycle, InkUnderline } from "../components/Motion";
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
  { title: "Brief", line: "Send the video or audio and the languages you need." },
  { title: "Translate", line: "We transcribe, translate and adapt the script for you to approve." },
  { title: "Voice", line: "Pick voices from our library; we fit them to the original timing." },
  { title: "Review and deliver", line: "Ask for changes until you sign off." },
];

const DELIVERABLES = [
  "The final mix, ready to publish",
  "Voice stems in WAV or MP3",
  "Subtitles in SRT and VTT",
  "A licence for each delivery",
];

const GOOD_TO_KNOW = [
  "Voice-over timed to each line, not lip-sync",
  "Turnaround agreed per project",
  "We sign an NDA before you send anything",
  "Files kept private, deleted after delivery if you ask",
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

export default function Dubbing() {
  return (
    <Shell>
      <div className="dub">
        <section className="dub-hero" aria-labelledby="dub-title">
          <p className="dub-eyebrow">ENTERPRISE</p>
          <h1 id="dub-title" className="dub-title">
            <InkUnderline>Dubbing</InkUnderline> for enterprises
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
          <p className="dub-lede muted">Your videos, ads and training, voiced in African languages and accents.</p>
          <p className="dub-for faint">For broadcasters, brands, agencies, NGOs and government.</p>
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

        <section className="dub-note card" aria-label="What you get and good to know">
          <PatternStrip pattern="kitenge" />
          <div className="dub-note-body">
            <div className="dub-note-col">
              <h2>What you get</h2>
              <ul className="dub-list" role="list">
                {DELIVERABLES.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="dub-note-col">
              <h2>Good to know</h2>
              <ul className="dub-list" role="list">
                {GOOD_TO_KNOW.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="dub-block" aria-labelledby="dub-voices">
          <h2 id="dub-voices">Languages and voices</h2>
          <p className="muted">{`${VOICES.length} voices with accents from ${LIVE_ACCENTS.length} African countries.`}</p>
          <ul className="dub-chips" role="list" aria-label={`${LANGUAGES.length} languages`}>
            {LANGUAGES.map((l) => (
              <li className="dub-chip" key={l.code}>
                {l.en ?? l.own}
              </li>
            ))}
          </ul>
          <p className="muted">Need another voice? Ask us to design one.</p>
        </section>

        <section className="dub-talk" aria-labelledby="dub-quote">
          <h2 id="dub-quote">Get a quote</h2>
          <p className="muted">Each project is quoted on minutes, languages and review rounds.</p>
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
