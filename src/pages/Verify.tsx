import { useEffect, useState, type FormEvent } from "react";
import { Shell } from "../components/Shell";
import { usePath } from "../router";
import "./Verify.css";

type Licence = { id: string; tier: string; voice: string; length: string; issued: string; paidKes?: number };

type Result = { kind: "found"; licence: Licence } | { kind: "missing" } | { kind: "bad" } | null;

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

function readLicences(): Licence[] {
  try {
    const raw = window.localStorage.getItem("mv.licences");
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as Licence[]) : [];
  } catch {
    return [];
  }
}

function lookup(input: string): Result {
  const id = input.trim().toUpperCase();
  if (!ID_RE.test(id)) return { kind: "bad" };
  const licence = readLicences().find((l) => typeof l?.id === "string" && l.id.toUpperCase() === id);
  return licence ? { kind: "found", licence } : { kind: "missing" };
}

function formatIssued(value: string): string {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return value || "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default function Verify() {
  const path = usePath();
  const [value, setValue] = useState(() => idFromPath(path));
  const [result, setResult] = useState<Result>(null);

  // Prefill (and check) when the page opens on /verify/<ID>.
  useEffect(() => {
    const id = idFromPath(path);
    if (id) {
      setValue(id);
      setResult(lookup(id));
    }
  }, [path]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const id = value.trim().toUpperCase();
    if (!id) {
      setResult({ kind: "bad" });
      return;
    }
    setValue(id);
    window.history.replaceState({}, "", `/verify/${encodeURIComponent(id)}`);
    setResult(lookup(id));
  };

  return (
    <Shell>
      <div className="verify">
        <div className="verify-intro">
          <h1>Check a licence</h1>
          <p className="muted">Enter the ID from the licence certificate.</p>
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
          <button type="submit" className="btn">
            Check
          </button>
        </form>

        <div aria-live="polite">
          {result?.kind === "bad" && (
            <p id="verify-error" className="verify-error">
              That does not look like a licence ID. It reads like VS-2026-8F3K2Q.
            </p>
          )}

          {result?.kind === "missing" && (
            <section className="card verify-result" aria-label="Result">
              <div className="verify-body">
                <h2>Not found: this ID was never issued.</h2>
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
                  <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
                    <circle cx="14" cy="14" r="13" fill="var(--green)" />
                    <path
                      className="tick"
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

        <p className="faint verify-note">Every clip also carries Google's inaudible SynthID watermark.</p>
      </div>
    </Shell>
  );
}
