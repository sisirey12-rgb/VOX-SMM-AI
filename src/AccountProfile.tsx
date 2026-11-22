import { useEffect, useState, type FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import { db } from "./catalogue";
import { readWalletSummary } from "./OverviewMetrics";

export function AccountProfile({ session, role, wallet }: {
  session: Session;
  role: string;
  wallet: () => void;
}) {
  const [name, setName] = useState("");
  const [profileReady, setProfileReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [balance, setBalance] = useState<Awaited<ReturnType<typeof readWalletSummary>>>();
  const user = session.user;
  useEffect(() => {
    const client = db;
    if (!client) return;
    let active = true;
    async function load() {
      const { data, error } = await client!.from("voxx_profiles").select("display_name").eq("id", user.id).single();
      if (!active) return;
      if (error) setMessage("Profile could not be loaded.");
      else {
        setName(data.display_name);
        setProfileReady(true);
      }
    }
    void load().catch(() => { if (active) setMessage("Profile could not be loaded."); });
    readWalletSummary(client).then((value) => { if (active) setBalance(value); })
      .catch(() => { if (active) setBalance(null); });
    return () => { active = false; };
  }, [user.id]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!db || saving) return;
    const displayName = name.trim();
    setSaving(true);
    try {
      const { error } = await db.from("voxx_profiles").update({ display_name: displayName }).eq("id", user.id);
      setMessage(error ? "Display name could not be saved." : "Display name saved.");
      if (!error) setName(displayName);
    } catch {
      setMessage("Display name could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const identity = name || user.email || "VOXX SMM";
  return (
    <div className="nexus-profile">
      <div className="nexus-profile-title">
        <span className="nexus-avatar" aria-hidden="true">{identity.slice(0, 2).toUpperCase()}</span>
        <div><strong>{identity}</strong><p>{user.email_confirmed_at ? "Email verified" : "Email verification pending"}</p></div>
      </div>
      <dl className="nexus-profile-details">
        <div><dt>Email</dt><dd>{user.email ?? "Unavailable"}</dd></div>
        <div><dt>Role</dt><dd>{role ? role.replace(/_/g, " ") : "Checking access"}</dd></div>
        <div><dt>Member since</dt><dd><time dateTime={user.created_at}>{new Date(user.created_at).toLocaleDateString()}</time></dd></div>
        <div><dt>Sign-in providers</dt><dd>{user.identities?.map(({ provider }) => provider).join(", ") || "Unavailable"}</dd></div>
      </dl>
      <details><summary>Account ID</summary><code>{user.id}</code></details>
      {profileReady && <form onSubmit={save}>
        <label>Display name<input maxLength={80} value={name} onChange={(event) => setName(event.target.value)} autoComplete="nickname" /></label>
        <button disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>
      </form>}
      {message && <p role="status">{message}</p>}
      <div className="nexus-profile-wallet">
        <div><strong>{balance?.mode === "test" ? "Test wallet" : "Wallet"}</strong><p>{balance === undefined ? "Loading balance…" : balance?.value ?? "Balance unavailable"}</p></div>
        <button type="button" onClick={wallet}>View wallet</button>
      </div>
    </div>
  );
}
