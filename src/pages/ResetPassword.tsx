import { useState, type FormEvent } from "react";
import { Link } from "../router";
import { supabase, useSession } from "../lib/supabase";
import { AuthFrame, MIN_PASSWORD, PasswordField, WELCOME_BACK, authErrorKind } from "./Signin";
import "./Signin.css";

export default function ResetPassword() {
  // supabase-js reads the recovery session from the link's URL on load.
  const session = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    if (password !== confirm) return setError("The passwords don't match.");
    setError("");
    setBusy(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password });
      if (err) throw err;
      setDone(true);
    } catch (err) {
      const kind = authErrorKind(err);
      if (kind === "same") setError("Choose a password you haven't used here before.");
      else if (kind === "weak") setError("That password is too easy to guess. Try a longer one.");
      else if (kind === "network") setError("Couldn't reach the server. Check your connection and try again.");
      else setError("We couldn't save it. Try again, or ask for a new reset link.");
    } finally {
      setBusy(false);
    }
  };

  if (session === undefined) {
    return (
      <AuthFrame greet={WELCOME_BACK}>
        <div className="auth-loading" aria-busy="true" />
      </AuthFrame>
    );
  }

  if (done) {
    return (
      <AuthFrame greet={WELCOME_BACK}>
        <div className="signin-head" aria-live="polite">
          <h1 className="signin-title">Password changed</h1>
          <p className="muted">You're signed in.</p>
        </div>
        <Link href="/dashboard" className="btn btn-block">
          Go to your dashboard
        </Link>
      </AuthFrame>
    );
  }

  if (!session) {
    return (
      <AuthFrame greet={WELCOME_BACK}>
        <div className="signin-head">
          <h1 className="signin-title">This link has expired</h1>
          <p className="muted">Reset links work once, for a short time. Ask for a new one.</p>
        </div>
        <Link href="/signin" className="btn btn-block">
          Go to sign in
        </Link>
      </AuthFrame>
    );
  }

  const errId = error ? "reset-error" : undefined;

  return (
    <AuthFrame greet={WELCOME_BACK}>
      <div className="signin-head">
        <h1 className="signin-title">Choose a new password</h1>
        {session.user.email && <p className="muted signin-who">{`For ${session.user.email}.`}</p>}
      </div>
      <form className="signin-form" onSubmit={submit} noValidate>
        <PasswordField
          id="new-password"
          label="New password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          invalid={!!error}
          describedBy={["reset-pw-hint", errId].filter(Boolean).join(" ")}
        />
        <p id="reset-pw-hint" className="faint signin-hint">
          At least {MIN_PASSWORD} characters.
        </p>
        <PasswordField
          id="confirm-password"
          label="Type it again"
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          invalid={!!error}
          describedBy={errId}
        />
        {error && (
          <p id="reset-error" className="signin-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-block" disabled={busy}>
          {busy ? "Saving…" : "Save new password"}
        </button>
      </form>
    </AuthFrame>
  );
}
