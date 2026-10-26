import { useState, type FormEvent } from "react";
import { Shell } from "../components/Shell";
import { getFlow } from "../flow";
import { Link, navigate } from "../router";
import { SITE_URL, supabase, useSession } from "../lib/supabase";
import "./Signin.css";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

export type AuthErrorKind = "credentials" | "unconfirmed" | "exists" | "weak" | "same" | "rate" | "network" | "other";

/** Sort a Supabase Auth error into a few cases we can explain in plain words. */
export function authErrorKind(err: unknown): AuthErrorKind {
  const e = (err ?? {}) as { code?: string; status?: number; message?: string };
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();
  if (code === "invalid_credentials" || msg.includes("invalid login")) return "credentials";
  if (code === "email_not_confirmed" || msg.includes("not confirmed")) return "unconfirmed";
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered")) return "exists";
  if (code === "same_password" || msg.includes("different from the old")) return "same";
  if (code === "weak_password" || msg.includes("password should") || msg.includes("weak")) return "weak";
  if (code.startsWith("over_") || e.status === 429 || msg.includes("rate limit")) return "rate";
  if (msg.includes("failed to fetch") || msg.includes("network")) return "network";
  return "other";
}

const RATE_TEXT = "Too many emails right now. Try again in a few minutes.";
const NETWORK_TEXT = "We couldn't reach the server. Check your connection and try again.";

/** Password input with a show/hide toggle. */
export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  invalid,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: "current-password" | "new-password";
  invalid?: boolean;
  describedBy?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="pw-wrap">
        <input
          id={id}
          type={show ? "text" : "password"}
          name={id}
          autoComplete={autoComplete}
          required
          minLength={autoComplete === "new-password" ? MIN_PASSWORD : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
        />
        <button
          type="button"
          className="pw-toggle"
          aria-label="Show password"
          aria-pressed={show}
          aria-controls={id}
          onClick={() => setShow((s) => !s)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 12 C5 7 8.5 5 12 5 C15.5 5 19 7 21.5 12 C19 17 15.5 19 12 19 C8.5 19 5 17 2.5 12 Z" />
            <circle cx="12" cy="12" r="3" />
            {show && <path d="M4 4 L20 20" />}
          </svg>
        </button>
      </div>
    </div>
  );
}

export function MailIcon() {
  return (
    <svg className="signin-icon" width="44" height="44" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5.5" width="18" height="13" rx="2" fill="none" stroke="var(--gold)" strokeWidth="1.6" />
      <path d="M3.8 7 L12 13 L20.2 7" fill="none" stroke="var(--gold)" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/** Where to go after signing in: a same-site ?next= path, else My clips. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}

type Mode = "password" | "link";
type Sent = { kind: "link" | "reset" | "confirm"; email: string } | null;

export default function Signin() {
  const session = useSession();
  const [next] = useState(nextPath);
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState(() => getFlow().email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Sent>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const cleanEmail = () => {
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setError("Enter an email address like name@example.com.");
      return null;
    }
    return value;
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = cleanEmail();
    if (!value) return;
    if (mode === "password" && !password) {
      setError("Enter your password.");
      return;
    }
    setError("");
    setUnconfirmed(false);
    setBusy(true);
    try {
      if (mode === "password") {
        const { error: err } = await supabase.auth.signInWithPassword({ email: value, password });
        if (err) throw err;
        navigate(next);
      } else {
        const { error: err } = await supabase.auth.signInWithOtp({
          email: value,
          options: { emailRedirectTo: `${SITE_URL}/dashboard`, shouldCreateUser: true },
        });
        if (err) throw err;
        setSent({ kind: "link", email: value });
      }
    } catch (err) {
      const kind = authErrorKind(err);
      if (kind === "credentials") setError("Wrong email or password.");
      else if (kind === "unconfirmed") {
        setError("Please confirm your email first — check your inbox.");
        setUnconfirmed(true);
      }
      else if (kind === "rate") setError(RATE_TEXT);
      else if (kind === "network") setError(NETWORK_TEXT);
      else setError(mode === "password" ? "We couldn't sign you in. Try again." : "We couldn't send the link. Check the address and try again.");
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    const value = cleanEmail();
    if (!value) return;
    setError("");
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(value, { redirectTo: `${SITE_URL}/reset-password` });
      if (err) throw err;
      setSent({ kind: "reset", email: value });
    } catch (err) {
      const kind = authErrorKind(err);
      setError(kind === "rate" ? RATE_TEXT : kind === "network" ? NETWORK_TEXT : "We couldn't send the reset email. Try again.");
    } finally {
      setBusy(false);
    }
  };

  // Accounts made while email was failing never got their confirmation link.
  const resendConfirmation = async () => {
    const value = cleanEmail();
    if (!value) return;
    setError("");
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.resend({ type: "signup", email: value, options: { emailRedirectTo: `${SITE_URL}/dashboard` } });
      if (err) throw err;
      setSent({ kind: "confirm", email: value });
    } catch (err) {
      const kind = authErrorKind(err);
      setError(kind === "rate" ? RATE_TEXT : kind === "network" ? NETWORK_TEXT : "We couldn't resend the confirmation email. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (session === undefined) {
    return (
      <Shell>
        <div className="narrow center signin" aria-busy="true" />
      </Shell>
    );
  }

  if (session) {
    const who = session.user.email;
    return (
      <Shell>
        <div className="narrow center signin">
          <div className="signin-head">
            <h1 className="signin-title">Signed in</h1>
            <p className="muted signin-who">{who ? `You're signed in as ${who}.` : "You're signed in."}</p>
          </div>
          <Link href="/dashboard" className="btn btn-block">
            Go to your dashboard
          </Link>
          <button
            type="button"
            className="signin-text-btn"
            onClick={() => {
              void supabase.auth.signOut();
            }}
          >
            Sign out
          </button>
        </div>
      </Shell>
    );
  }

  if (sent) {
    return (
      <Shell>
        <div className="narrow center signin">
          <section className="signin-sent" aria-live="polite">
            <MailIcon />
            <h1 className="signin-title-sm">Check your email</h1>
            <p className="muted">
              {sent.kind === "link"
                ? `We sent a sign-in link to ${sent.email}. Open it on this device to sign in.`
                : sent.kind === "confirm"
                  ? `We sent a new confirmation link to ${sent.email}. Open it to finish creating your account.`
                  : `If ${sent.email} has an account, we sent a link to set a new password. Open it to continue.`}
            </p>
            <button
              type="button"
              className="signin-text-btn"
              onClick={() => {
                setSent(null);
                setError("");
              }}
            >
              {sent.kind === "link" ? "Use a different email" : "Back to sign in"}
            </button>
          </section>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="narrow center signin">
        <div className="signin-head">
          <h1 className="signin-title">Sign in</h1>
          <p className="muted">{mode === "password" ? "Welcome back." : "We'll email you a link. No password needed."}</p>
        </div>
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
          {mode === "password" && (
            <>
              <PasswordField
                id="password"
                label="Password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                invalid={!!error}
                describedBy={error ? "signin-error" : undefined}
              />
              <button type="button" className="signin-text-btn signin-forgot" onClick={forgot} disabled={busy}>
                Forgot password?
              </button>
            </>
          )}
          {error && (
            <p id="signin-error" className="signin-error" role="alert">
              {error}
            </p>
          )}
          {unconfirmed && (
            <button type="button" className="signin-text-btn" onClick={resendConfirmation} disabled={busy}>
              Resend confirmation email
            </button>
          )}
          <button type="submit" className="btn btn-block" disabled={busy}>
            {mode === "password" ? (busy ? "Signing in…" : "Sign in") : busy ? "Sending…" : "Email me a link"}
          </button>
        </form>

        <button
          type="button"
          className="signin-text-btn"
          onClick={() => {
            setMode(mode === "password" ? "link" : "password");
            setError("");
          }}
        >
          {mode === "password" ? "Email me a sign-in link instead" : "Use my password instead"}
        </button>

        <p className="faint signin-new">
          New here? <Link href="/signup">Create an account</Link>
        </p>
      </div>
    </Shell>
  );
}
