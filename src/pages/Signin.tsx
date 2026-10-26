import { useState, type FormEvent } from "react";
import { Shell } from "../components/Shell";
import { API_MODE, getSession, requestMagicLink, signOut } from "../lib/api";
import { getFlow } from "../flow";
import { Link } from "../router";
import "./Signin.css";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Signin() {
  const [email, setEmail] = useState(() => getFlow().email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [session, setSession] = useState(() => getSession());

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError("Enter an email address like name@example.com.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await requestMagicLink(value);
      setSentTo(value);
    } catch {
      setError("We couldn't send the link. Check the address and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (session) {
    return (
      <Shell>
        <div className="narrow center signin">
          <div className="signin-head">
            <h1 className="signin-title">Signed in</h1>
            <p className="muted">{session.email ? `You're signed in as ${session.email}.` : "You're signed in."}</p>
          </div>
          <Link href="/clips" className="btn btn-block">
            Go to My clips
          </Link>
          <button
            type="button"
            className="signin-text-btn"
            onClick={() => {
              signOut();
              setSession(null);
            }}
          >
            Sign out
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="narrow center signin">
        <div className="signin-head">
          <h1 className="signin-title">Sign in</h1>
          {!sentTo && <p className="muted">We'll email you a link. No password needed.</p>}
        </div>
        {sentTo ? (
          <section className="signin-sent" aria-live="polite">
            <svg className="signin-icon" width="44" height="44" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5.5" width="18" height="13" rx="2" fill="none" stroke="var(--gold)" strokeWidth="1.6" />
              <path d="M3.8 7 L12 13 L20.2 7" fill="none" stroke="var(--gold)" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            <h2 className="signin-title-sm">Check your email</h2>
            <p className="muted">{`We sent a sign-in link to ${sentTo}. It works for 15 minutes.`}</p>
            {API_MODE === "demo" && (
              <p className="faint signin-note">
                Demo mode: no email is sent yet. <Link href="/clips">Go to My clips</Link>
              </p>
            )}
            <button
              type="button"
              className="signin-text-btn"
              onClick={() => {
                setSentTo("");
                setError("");
              }}
            >
              Use a different email
            </button>
          </section>
        ) : (
          <>
            <form className="signin-form" onSubmit={submit} noValidate>
              <label className="field">
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? "signin-error" : undefined}
                />
              </label>
              {error && (
                <p id="signin-error" className="signin-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="btn btn-block" disabled={busy}>
                {busy ? "Sending…" : "Email me a link"}
              </button>
              {API_MODE === "demo" && <p className="faint signin-note">Demo mode: no email is sent yet.</p>}
            </form>
          </>
        )}

        <p className="faint signin-new">
          New here? You don't need an account to try. <Link href="/studio">Paste a script</Link>
        </p>
      </div>
    </Shell>
  );
}
