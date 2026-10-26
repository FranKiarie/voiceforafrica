// Languages Gemini TTS speaks today, written in their own script. Yoruba, Zulu
// and Luo are not supported by the models yet, so they are left out.
const LANGUAGES: { own: string; en?: string; code: string }[] = [
  { own: "English", code: "en" },
  { own: "Kiswahili", en: "Swahili", code: "sw" },
  { own: "Gĩkũyũ", en: "Kikuyu", code: "ki" },
  { own: "Kĩkamba", en: "Kamba", code: "kam" },
  { own: "Oluganda", en: "Luganda", code: "lg" },
  { own: "Hausa", code: "ha" },
  { own: "አማርኛ", en: "Amharic", code: "am" },
  { own: "Ikinyarwanda", en: "Kinyarwanda", code: "rw" },
  { own: "Igbo", code: "ig" },
  { own: "Soomaali", en: "Somali", code: "so" },
  { own: "Lingála", en: "Lingala", code: "ln" },
  { own: "Akan", en: "Twi", code: "ak" },
  { own: "Chinyanja", en: "Nyanja", code: "ny" },
  { own: "ትግርኛ", en: "Tigrinya", code: "ti" },
  { own: "Sesotho", en: "Sotho", code: "st" },
  { own: "Afrikaans", code: "af" },
  { own: "Français", en: "French", code: "fr" },
  { own: "Português", en: "Portuguese", code: "pt" },
  { own: "العربية", en: "Arabic", code: "ar" },
];

const BEAD_COLOURS = ["#D0442A", "#E8A33C", "#3F57B8", "#2E9E6B"];

function KangaBand() {
  return (
    <div className="kanga" aria-hidden="true">
      <svg className="kanga-strip" width="3030" height="14">
        <defs>
          <pattern id="kanga" width="30" height="14" patternUnits="userSpaceOnUse">
            <rect width="30" height="14" fill="#D0442A" />
            <path d="M15 2 L22 7 L15 12 L8 7 Z" fill="#E8A33C" />
            <circle cx="15" cy="7" r="1.6" fill="#1A110C" />
            <circle cx="1.5" cy="7" r="1.5" fill="#F6EAD7" />
            <circle cx="28.5" cy="7" r="1.5" fill="#F6EAD7" />
          </pattern>
        </defs>
        <rect width="3030" height="14" fill="url(#kanga)" />
      </svg>
    </div>
  );
}

function LanguageMarquee() {
  // Rendered twice so the -50% loop is seamless.
  const loop = [...LANGUAGES, ...LANGUAGES];
  return (
    <section className="marquee" aria-label="Languages we speak">
      <div className="marquee-track">
        {loop.map((lang, i) => (
          <span className="marquee-item" key={i} aria-hidden={i >= LANGUAGES.length}>
            <span className="lang-own" lang={lang.code}>{lang.own}</span>
            {lang.en && <span className="lang-en">{lang.en}</span>}
            <svg width="10" height="10" aria-hidden="true">
              <circle cx="5" cy="5" r="5" fill={BEAD_COLOURS[i % BEAD_COLOURS.length]} />
            </svg>
          </span>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  return (
    <div className="page">
      <KangaBand />
      <header className="header">
        <a href="/" className="brand">
          <img className="logo logo-light" src="/brand/mikaka-logo-primary.png" alt="Mikaka" />
          <img className="logo logo-dark" src="/brand/mikaka-logo-white.png" alt="Mikaka" />
          <span className="brand-rule" />
          <span className="brand-voice">Voice</span>
        </a>
      </header>

      <main>
        <section className="hero">
          <p className="eyebrow">KARIBU</p>
          <h1>Voice-overs in your accent.</h1>
          <p className="lede">Paste a script, hear 45 seconds free, pay with M-Pesa.</p>
          <p className="soon">Opening soon on voice.mikaka.io</p>
        </section>

        <LanguageMarquee />
        <p className="count">{LANGUAGES.length} languages, Kenyan voices first.</p>
      </main>

      <footer className="footer">
        <span className="footer-brand">
          <img src="/brand/mikaka-mark.png" alt="" width="22" height="22" />
          voice.mikaka.io
        </span>
      </footer>
    </div>
  );
}
