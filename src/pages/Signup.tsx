import { useState, type FormEvent, type ReactNode } from "react";
import { Shell } from "../components/Shell";
import { getFlow } from "../flow";
import { Link, navigate } from "../router";
import { SITE_URL, supabase } from "../lib/supabase";
import { EMAIL_RE, MIN_PASSWORD, MailIcon, PasswordField, authErrorKind } from "./Signin";
import "./Signin.css";
import "./Signup.css";

export default function Signup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(() => getFlow().email ?? "");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReactNode>(null);
  const [sentTo, setSentTo] = useState("");

  const exists = (
    <>
      That email already has an account. <Link href="/signin">Sign in instead.</Link>
    </>
  );

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = email.trim();
    if (!EMAIL_RE.test(value)) return setError("Enter an email address like name@example.com.");
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
    if (!agree) return setError("Please confirm you're 18 or older and accept the Terms.");
    setError(null);
    setBusy(true);
    try {
      const fullName = name.trim();
      const { data, error: err } = await supabase.auth.signUp({
        email: value,
        password,
        options: { emailRedirectTo: `${SITE_URL}/clips`, data: fullName ? { full_name: fullName } : {} },
      });
      if (err) throw err;
      if (data.session) {
        navigate("/clips");
        return;
      }
      // With email confirmations on, an existing address comes back with no identities.
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        setError(exists);
        return;
      }
      setSentTo(value);
    } catch (err) {
      const kind = authErrorKind(err);
      if (kind === "exists") setError(exists);
      else if (kind === "weak") setError("That password is too easy to guess. Try a longer one with letters and numbers.");
      else if (kind === "rate") setError("Too many emails right now. Try again in a few minutes.");
      else if (kind === "network") setError("We couldn't reach the server. Check your connection and try again.");
      else setError("We couldn't create your account. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (sentTo) {
    return (
      <Shell>
        <div className="narrow center signin">
          <section className="signin-sent" aria-live="polite">
            <MailIcon />
            <h1 className="signin-title-sm">Check your email</h1>
            <p className="muted">{`We sent a link to ${sentTo}. Open it to finish creating your account.`}</p>
            <button type="button" className="signin-text-btn" onClick={() => setSentTo("")}>
              Use a different email
            </button>
          </section>
        </div>
      </Shell>
    );
  }

  const errId = error ? "signup-error" : undefined;

  return (
    <Shell>
      <div className="narrow center signin">
        <div className="signin-head">
          <h1 className="signin-title">Create your account</h1>
          <p className="muted">Keep your clips and licences in one place.</p>
        </div>
        <form className="signin-form" onSubmit={submit} noValidate>
          <label className="field">
            <span>
              Name <span className="signup-optional">(optional)</span>
            </span>
            <input type="text" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
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
              aria-describedby={errId}
            />
          </label>
          <PasswordField
            id="new-password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            describedBy={["signup-pw-hint", errId].filter(Boolean).join(" ")}
          />
          <p id="signup-pw-hint" className="faint signin-hint">
            At least {MIN_PASSWORD} characters.
          </p>
          <label className="signup-check">
            <input type="checkbox" required checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>
              I'm 18 or older and accept the <Link href="/terms">Terms</Link>
            </span>
          </label>
          {error && (
            <p id="signup-error" className="signin-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-block" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="faint signin-new">
          Already have an account? <Link href="/signin">Sign in</Link>
        </p>
      </div>
    </Shell>
  );
}
