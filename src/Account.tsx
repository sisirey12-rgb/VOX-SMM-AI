import { useState, useEffect, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { Security } from "./Security";
import { db } from "./catalogue";
import { AccountProfile } from "./AccountProfile";

export function useAccount() {
  const [ready, setReady] = useState(!db);
  const [session, setSession] = useState<Session | null>(null),
    [authorization, setAuthorization] = useState<{ session: Session; role: string; admin: boolean } | null>(null);
  useEffect(() => {
    if (!db) return;
    const { data } = db.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    let active = true;
    if (session && db) {
      Promise.all([db.rpc("voxx_role"), db.rpc("voxx_admin")]).then(([role, admin]) => {
        if (active) setAuthorization({ session, role: role.error ? "" : role.data ?? "", admin: !admin.error && admin.data === true });
      }).catch(() => {
        if (active) setAuthorization(null);
      });
    } else setAuthorization(null);
    return () => {
      active = false;
    };
  }, [session]);
  const current = authorization?.session === session ? authorization : null;
  return {
    ready,
    session,
    accountRole: current?.role ?? "",
    isAdmin: current?.admin === true,
  };
}

export function Account({ session, register = false, role, wallet, onSignedIn }: { session: Session | null; register?: boolean; role: string; wallet: () => void; onSignedIn: () => void }) {
  const [signup, toggle] = useState(register),
    [busy, setBusy] = useState(false),
    [showPassword, setShowPassword] = useState(false),
    [message, setMessage] = useState(() => {
      const query = new URLSearchParams(location.search);
      const fragment = new URLSearchParams(location.hash.slice(1));
      return query.has("error") || fragment.has("error") ? "Sign-in could not be completed. Please try again." : "";
    });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!db) return;
    const values = new FormData(e.currentTarget);
    const credentials = {
      email: String(values.get("email")).trim(),
      password: String(values.get("password")),
    };
    setBusy(true);
    setMessage("");
    try {
      const { error } = signup
        ? await db.auth.signUp(credentials)
        : await db.auth.signInWithPassword(credentials);
      if (!error && !signup) onSignedIn();
      setMessage(
        error
          ? error.message
          : signup
            ? "Check your email if confirmation is required."
            : "Signed in.",
      );
    } catch {
      setMessage("Connection failed. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function signInWithGoogle() {
    if (!db) return;
    setBusy(true);
    setMessage("");
    try {
      const { error } = await db.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/?account=google` },
      });
      if (!error) return;
      setMessage(error.message);
    } catch {
      setMessage("Google sign-in failed. Try again.");
    }
    setBusy(false);
  }
  return (
    <section className="panel form-panel catalog nexus-account" aria-busy={busy}>
      <img className="nexus-account-brand" src="/brand/voxx-wordmark.svg" alt="VOXX SMM" />
      <h3>
        {session
          ? "Your account"
          : signup
            ? "Create an account"
            : "Sign in to VOXX SMM"}
      </h3>
      {session ? (
        <>
          <AccountProfile key={session.user.id} session={session} role={role} wallet={wallet} />
          <button
            onClick={async () => {
              setBusy(true);
              try {
                const result = await db!.auth.signOut();
                setMessage(result.error ? result.error.message : "Signed out.");
              } catch {
                setMessage("Sign-out failed. Try again.");
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            Sign out
          </button>
        </>
      ) : db ? (
        <form onSubmit={submit}>
          <label>
            Email
            <input required name="email" type="email" autoComplete="email" />
          </label>
          <label>
            Password
            <input
              required
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete={signup ? "new-password" : "current-password"}
            />
          </label>
          <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide password" : "Show password"}</button>
          <button disabled={busy}>
            {signup ? "Create account" : "Sign in"}
          </button>{" "}
          <button
            type="button"
            onClick={() => {
              toggle(!signup);
              setMessage("");
            }}
          >
            {signup ? "Use existing account" : "Register"}
          </button>
          <button className="nexus-google" type="button" disabled={busy} onClick={signInWithGoogle}>
            Continue with Google
          </button>
        </form>
      ) : (
        <p>
          Account access opens when this deployment is connected to Supabase.
        </p>
      )}
      <p role="status">{message}</p>
      <Security key={session?.user.id} signedIn={!!session} />
    </section>
  );
}
