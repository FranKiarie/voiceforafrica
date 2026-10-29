import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { InkUnderline } from "../components/Motion";
import { Shell } from "../components/Shell";
import { verifyLicence, type Licence } from "../lib/api";
import { usePath } from "../router";
import "./Verify.css";

type Result =
  | { kind: "found"; licence: Licence }
  | { kind: "missing" }
  | { kind: "bad" }
  | { kind: "loading" }
  | { kind: "error" }
  | null;

const ID_RE = /^VS-\d{4}-[A-Z0-9]{6}$/i;

function idFromPath(path: string): string {
  const m = path.match(/^\/verify\/([^/]+)\/?$/);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function formatIssued(value: string): string {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return value || "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/** A ticked shield above the title. Decorative and still. */
function ShieldCheck() {
  return (
    <svg className="verify-shield" width="48" height="56" viewBox="0 0 48 56" aria-hidden="true">
      <path className="vs-shield" d="M24 3.5 L42 10 V25.5 C42 38 34.5 47 24 52 C13.5 47 6 38 6 25.5 V10 Z" />
      <path className="vs-check" d="M16 28.5 L21.5 34 L32.5 22" />
    </svg>
  );
}

export default function Verify() {
  const path = usePath();
  const [value, setValue] = useState(() => idFromPath(path));
  const [result, setResult] = useState<Result>(null);
  const seq = useRef(0);

  const lookup = useCallback(async (input: string) => {
    const id = input.trim().toUpperCase();
    const n = ++seq.current;
    if (!ID_RE.test(id)) {
      setResult({ kind: "bad" });
      return;
    }
    setResult({ kind: "loading" });
    try {
      const licence = await verifyLicence(id);
      if (n !== seq.current) return;
      setResult(licence ? { kind: "found", licence } : { kind: "missing" });
    } catch {
      if (n === seq.current) setResult({ kind: "error" });
    }
  }, []);

  // Prefill (and check) when the page opens on /verify/<ID>.
  useEffect(() => {
    const id = idFromPath(path);
    if (id) {
      setValue(id);
      void lookup(id);
    }
  }, [path, lookup]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const id = value.trim().toUpperCase();
    if (!id) {
      setResult({ kind: "bad" });
      return;
    }
    setValue(id);
    window.history.replaceState({}, "", `/verify/${encodeURIComponent(id)}`);
    void lookup(id);
  };

  return (
    <Shell>
      <div className="verify">
        <div className="verify-intro">
          <ShieldCheck />
          <h1>
            Check a <InkUnderline>licence</InkUnderline>
          </h1>
          <p className="muted">Enter the ID from the certificate.</p>
        </div>

        <form className="verify-form" aria-label="Check a licence" onSubmit={onSubmit} noValidate>
          <label className="verify-label">
            <span className="sr-only">Licence ID</span>
            <input
              type="text"
              className="mono"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="VS-2026-8F3K2Q"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={result?.kind === "bad" ? true : undefined}
              aria-describedby={result?.kind === "bad" ? "verify-error" : undefined}
            />
          </label>
          <button type="submit" className="btn" disabled={result?.kind === "loading"}>
            {result?.kind === "loading" ? "Checking…" : "Check"}
          </button>
        </form>

        <div aria-live="polite">
          {result?.kind === "loading" && <p className="muted">Checking…</p>}

          {result?.kind === "error" && (
            <p className="verify-error" role="alert">
              Couldn't reach the licence service. Check your connection and try again.
            </p>
          )}

          {result?.kind === "bad" && (
            <p id="verify-error" className="verify-error">
              That isn't a licence ID. IDs look like VS-2026-8F3K2Q.
            </p>
          )}

          {result?.kind === "missing" && (
            <section className="card verify-result" aria-label="Result">
              <div className="verify-body">
                <h2>Not found: this ID was never issued</h2>
              </div>
            </section>
          )}

          {result?.kind === "found" && (
            <section className="card verify-result" aria-label="Result">
              <div className="verify-edge" aria-hidden="true">
                <svg width="6" height="100%">
                  <rect width="6" height="100%" fill="url(#adire)" />
                </svg>
              </div>
              <div className="verify-body">
                <div className="verify-head">
                  <svg className="verify-seal" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
                    <circle cx="14" cy="14" r="13" fill="var(--green)" />
                    <path
                      d="M8 14.5 L12.5 19 L20 10"
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <h2>Valid · {result.licence.tier} licence</h2>
                </div>
                <dl className="verify-dl">
                  <div>
                    <dt>Issued</dt>
                    <dd>{formatIssued(result.licence.issued)}</dd>
                  </div>
                  <div>
                    <dt>Voice</dt>
                    <dd>{result.licence.voice}</dd>
                  </div>
                  <div>
                    <dt>Length</dt>
                    <dd>{result.licence.length}</dd>
                  </div>
                  <div>
                    <dt>Licence ID</dt>
                    <dd className="mono">{result.licence.id}</dd>
                  </div>
                </dl>
              </div>
            </section>
          )}
        </div>

        <p className="faint verify-note">Clips also carry Google's inaudible SynthID watermark.</p>
      </div>
    </Shell>
  );
}
