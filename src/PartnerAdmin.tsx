import { useEffect, useState } from "react";
import { db } from "./catalogue";
import { GlassDialog, Status } from "./UltraGlass";
export function PartnerAdmin() {
  const [keys, setKeys] = useState<
      { id: string; owner_id: string; revoked: boolean }[]
    >([]),
    [msg, tell] = useState(""),
    [revoking, setRevoking] = useState(false),
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
        <article className="glass-reseller-key" key={k.id}>
          <div><strong>{k.id}</strong><small>Owner {k.owner_id}</small></div>
          <Status>{k.revoked ? "Revoked" : "Active"}</Status>
          {!k.revoked && <GlassDialog title="Revoke API key" trigger="Revoke">
            {(close) => <div className="glass-dialog-body"><p>Requests using this key will stop working.</p><button className="glass-action" disabled={revoking}
              onClick={async () => {
                setRevoking(true);
                try {
                  const r = await db!.rpc("voxx_revoke_key", { key_id: k.id });
                  tell(r.error?.message ?? "Key revoked.");
                  refresh((version) => version + 1);
                  close();
                } catch {
                  tell("Could not revoke the key. Try again.");
                  close();
                } finally {
                  setRevoking(false);
                }
              }}
            >
              Confirm revoke
            </button></div>}
          </GlassDialog>}
        </article>
      ))}
      <p role="status">{msg}</p>
    </section>
  );
}
