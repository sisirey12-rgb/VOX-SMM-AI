import { useEffect, useState } from "react";
import { db } from "./catalogue";
import { ResellerApiGuide } from "./ResellerApiGuide";
export function Partner({ user }: { user: string }) {
  const [keys, list] = useState<{ id: string; revoked: boolean }[]>([]),
    [secret, show] = useState(""),
    [issuing, setIssuing] = useState(false),
    [message, tell] = useState(""),
    [v, reload] = useState(0),
    [allowed, setAllowed] = useState(false),
    [store, setStore] = useState<{
      id: string;
      name: string;
      colour: string;
    } | null>(null);
  useEffect(() => {
    let active = true;
    if (!db || !user) return;
    Promise.all([
      db.rpc("voxx_key_list"),
      db.rpc("voxx_role"),
      db
        .from("voxx_stores")
        .select("id,name,colour")
        .eq("owner_id", user)
        .maybeSingle(),
    ]).then(([k, r, s]) => {
      if (active) {
        list(k.data ?? []);
        setAllowed(r.data === "reseller");
        setStore(s.data);
      }
    });
    return () => {
      active = false;
    };
  }, [user, v]);
  const endpoint = new URL("/api/reseller", window.location.origin).href;
  return (
    <section className="panel form-panel catalog reseller-api">
      <ResellerApiGuide endpoint={endpoint} />
      {!user && <p>Sign in to request reseller API access.</p>}
      {!!user && !allowed && <p>Contact VOXX Support to request reseller access. Key generation is available after your account is enabled.</p>}
      {allowed && <>
        <details>
          <summary>Storefront settings</summary>
          <form
            key={store?.id}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const data = {
                id: String(f.get("slug")),
                name: String(f.get("name")),
                colour: String(f.get("colour")),
              };
              const r = store
                ? await db!.from("voxx_stores").update(data).eq("owner_id", user)
                : await db!.from("voxx_stores").insert(data);
              tell(r.error ? r.error.message : "Storefront saved.");
              reload(v + 1);
            }}
          >
            <label>
              Store name
              <input name="name" required defaultValue={store?.name} />
            </label>
            <label>
              URL slug
              <input
                name="slug"
                required
                pattern="[a-z0-9-]{3,48}"
                defaultValue={store?.id}
              />
            </label>
            <label>
              Brand colour
              <input
                type="color"
                name="colour"
                defaultValue={store?.colour ?? "#8b5cf6"}
              />
            </label>
            <button>Save storefront</button>
          </form>
          {store && <a href={"?store=" + store.id}>Open storefront</a>}
        </details>
        <h3>API keys</h3>
        <button
          disabled={issuing}
          onClick={async () => {
            setIssuing(true);
            tell("");
            try {
              const session = (await db!.auth.getSession()).data.session;
              if (!session?.access_token) throw Error("Sign in again to create a key.");
              const res = await fetch("/api/reseller?issue=1", {
                method: "POST",
                headers: { Authorization: "Bearer " + session.access_token },
              });
              const r = await res.json();
              if (!res.ok) throw Error(r.error);
              show(r.key);
              reload(v + 1);
            } catch (e) {
              tell((e as Error).message);
            } finally {
              setIssuing(false);
            }
          }}
        >
          Create API key
        </button>
        {secret && (
          <label>
            Copy this key now
            <input readOnly value={secret} />
            <button onClick={() => show("")}>Hide key</button>
          </label>
        )}
        {keys.map((k) => (
          <p key={k.id}>
            {k.id}{" "}
            {k.revoked ? (
              "Revoked"
            ) : (
              <button
                onClick={async () => {
                  const r = await db!.rpc("voxx_revoke_key", { key_id: k.id });
                  tell(r.error?.message ?? "Key revoked.");
                  reload(v + 1);
                }}
              >
                Revoke
              </button>
            )}
          </p>
        ))}
        <p role="status">{message}</p>
      </>}
    </section>
  );
}
export function StoreBanner({ user }: { user: string }) {
  const slug = new URLSearchParams(location.search).get("store"),
    [name, setName] = useState(""),
    [colour, setColour] = useState(""),
    [msg, tell] = useState("");
  useEffect(() => {
    if (slug && db)
      db.from("voxx_stores")
        .select("name,colour")
        .eq("id", slug)
        .maybeSingle()
        .then((r) => {
          setName(r.data?.name ?? "");
          setColour(r.data?.colour ?? "");
        });
  }, [slug]);
  if (!name) return null;
  return (
    <div className="panel" style={{ borderColor: colour }}>
      <h2>{name}</h2>
      {user ? (
        <button
          onClick={async () => {
            const r = await db!.rpc("voxx_join_store", { slug });
            tell(r.error?.message ?? "Account linked to this store.");
          }}
        >
          Join this storefront
        </button>
      ) : (
        <p>Sign in to join this storefront.</p>
      )}
      <p>{msg}</p>
    </div>
  );
}
