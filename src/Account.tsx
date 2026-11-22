import { useState, useEffect, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { Security } from "./Security";
import { db } from "./catalogue";

export function useAccount() {
  const [session, setSession] = useState<Session | null>(null),
    [adminId, setAdminId] = useState(""),
    [accountRole, setAccountRole] = useState("");
  useEffect(() => {
    if (!db) return;
    const { data } = db.auth.onAuthStateChange((_event, next) =>
      setSession(next),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    let active = true;
    setAdminId("");
    setAccountRole("");
    if (session && db)
      db.rpc("voxx_role").then(({ data }) => {
        if (active) {
          setAccountRole(data ?? "");
          if (["super_admin", "admin"].includes(data))
            setAdminId(session.user.id);
        }
      });
    return () => {
      active = false;
    };
  }, [session]);
  return {
    session,
    accountRole,
    isAdmin: !!session && adminId === session.user.id,
  };
}

export function Account({ session }: { session: Session | null }) {
  const [signup, toggle] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
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
  return (
    <section className="panel form-panel catalog">
      <h3>
        {session
          ? "Your account"
          : signup
            ? "Create an account"
            : "Sign in to VOXX"}
      </h3>
      {session ? (
        <>
          <p>{session.user.email}</p>
          <button
            onClick={async () => {
              const result = await db!.auth.signOut();
              setMessage(result.error ? result.error.message : "Signed out.");
            }}
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
              type="password"
              autoComplete={signup ? "new-password" : "current-password"}
            />
          </label>
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
