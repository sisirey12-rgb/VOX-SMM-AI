import { useEffect, useState } from "react";
import { db } from "./catalogue";
export function PartnerAdmin() {
  const [keys, setKeys] = useState<
      { id: string; owner_id: string; revoked: boolean }[]
    >([]),
    [msg, tell] = useState(""),
    [v, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    db?.rpc("voxx_list_api_keys").then((r) => {
      if (active) {
        setKeys(r.data ?? []);
        if (r.error) tell(r.error.message);
      }
    });
    return () => {
      active = false;
    };
  }, [v]);
  return (
    <section className="panel">
      <h3>Reseller API credentials</h3>
      {!keys.length && <p>No keys issued.</p>}
      {keys.map((k) => (
        <p key={k.id}>
          {k.id} · {k.owner_id}{" "}
          {k.revoked ? (
            "Revoked"
          ) : (
            <button
              onClick={async () => {
                const r = await db!.rpc("voxx_revoke_key", { key_id: k.id });
                tell(r.error?.message ?? "Key revoked.");
                refresh(v + 1);
              }}
            >
              Revoke
            </button>
          )}
        </p>
      ))}
      <p role="status">{msg}</p>
    </section>
  );
}
