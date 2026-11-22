import { useEffect, useState } from "react";
import { Reconcile, OrderCredit } from "./Reconcile";
import {
  ProgressGraph,
  ConfirmedProgress,
  readProgress,
} from "./ProgressGraph";
import type { History } from "./progress";
import { db, money } from "./catalogue";
import { Loading, Status } from "./UltraGlass";
export async function operation(action: string, id?: string) {
  const session = await db?.auth.getSession();
  const token = session?.data.session?.access_token;
  if (!token) throw Error("Sign in required");
  const res = await fetch("/api/operations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ action, id }),
  });
  if (!res.ok)
    throw Error(
      "Operation unavailable. Check the order record and configuration.",
    );
  return res.json();
}
type Order = {
  id: string;
  service_name: string;
  total_inr: number;
  state: string;
  automatic_release: boolean;
  provider_status: string | null;
  target: string;
  quantity: number;
  aftercare: string | null;
  campaign_id: string | null;
};
export function Orders({
  manage,
  user,
  detail,
}: {
  manage: boolean;
  user?: string;
  detail?: string;
}) {
  const [orders, setOrders] = useState<Order[]>([]),
    [message, setMessage] = useState(""),
    [revision, refresh] = useState(0),
    [busy, setBusy] = useState(false);
  const [graphs, setGraphs] = useState<Record<string, History>>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    if (!user || !db) return;
    async function tick() {
      try {
        let q = db!
          .from("voxx_orders")
          .select(
            "id,service_name,total_inr,state,provider_status,target,quantity,aftercare,campaign_id,automatic_release",
          )
          .order("created_at", { ascending: false })
          .limit(detail ? 240 : 100);
        if (detail) {
          if (!/^[a-f0-9-]{36}$/i.test(detail)) throw Error("Invalid order ID");
          q = q.or("id.eq." + detail + ",campaign_id.eq." + detail);
        }
        if (!manage) q = q.eq("owner_id", user);
        const r = await q;
        if (r.error) throw r.error;
        const rows = r.data ?? [];
        const ids = [
          ...new Set(rows.map((o) => detail ?? o.campaign_id ?? o.id)),
        ];
        const histories = await readProgress(ids);
        if (active) {
          setOrders(rows);
          setGraphs(histories);
          setMessage("");
        }
      } catch {
        if (active)
          setMessage(
            "Order history could not refresh. Showing the last available records.",
          );
      } finally {
        if (active) {
          setLoaded(true);
          timer = setTimeout(tick, 10000);
        }
      }
    }
    void tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [user, manage, detail, revision]);
  const groups = new Map<string, Order[]>();
  for (const order of orders) {
    const id = detail ?? order.campaign_id ?? order.id;
    const group = groups.get(id) ?? [];
    group.push(order);
    groups.set(id, group);
  }
  async function act(action: string, id?: string) {
    if (
      id &&
      !window.confirm(
        action === "dispatch"
          ? "Charge the customer wallet and submit this order to SMMXPERT?"
          : "Send this " + action + " request to SMMXPERT?",
      )
    )
      return;
    setBusy(true);
    try {
      await operation(action, id);
      refresh((v) => v + 1);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!user) return <p>Sign in to view your orders.</p>;
  return (
    <div className="catalog">
      <p role="status">{message}</p>
      <button onClick={() => refresh((v) => v + 1)}>
        Refresh history
      </button>{" "}
      {manage && (
        <button disabled={busy} onClick={() => act("poll")}>
          Sync provider statuses
        </button>
      )}
      {!loaded && db && <Loading label="Loading order history" />}
      {loaded && !orders.length && !message && <p>No orders to display.</p>}
      {[...groups].map(([id, items]) => (
        <article className="panel" key={id}>
          <div className="glass-order-heading"><h3>{items[0].service_name}</h3>{items.length === 1 && <Status>{items[0].provider_status ?? items[0].state}</Status>}</div>
          {graphs[id] && (
            <ProgressGraph history={graphs[id]} expanded={!!detail} />
          )}
          {!detail && (
            <p>
              <a href={"?order=" + id}>Full order details</a>
            </p>
          )}
          {(detail || items.length === 1 ? items : []).map((o) => (
            <section key={o.id}>
              <p>
                {o.quantity} units · {money(o.total_inr)} {items.length > 1 && <Status>{o.provider_status ?? (o.automatic_release && o.state === "Awaiting review" ? "Queued" : o.state)}</Status>}
              </p>
              <small>
                {o.target} · {o.id}
              </small>
              {o.aftercare && <p>{o.aftercare}</p>}
              {manage && !o.aftercare && o.state === "Submitted" && (
                <button disabled={busy} onClick={() => act("cancel", o.id)}>
                  Request cancellation
                </button>
              )}
              {manage &&
                !o.aftercare &&
                ["Completed", "Partial"].includes(o.provider_status ?? "") && (
                  <button disabled={busy} onClick={() => act("refill", o.id)}>
                    Request refill
                  </button>
                )}
              {manage &&
                ["Submitting", "Needs reconciliation"].includes(o.state) && (
                  <Reconcile id={o.id} refresh={() => refresh((v) => v + 1)} />
                )}
              {manage &&
                o.state === "Closed" &&
                ["partial", "canceled", "cancelled"].includes(
                  (o.provider_status ?? "").toLowerCase(),
                ) && <OrderCredit id={o.id} />}
              {manage && !o.automatic_release && o.state === "Awaiting review" && (
                <button disabled={busy} onClick={() => act("dispatch", o.id)}>
                  Approve provider spend
                </button>
              )}
            </section>
          ))}
        </article>
      ))}
    </div>
  );
}
export function OrderForm({
  service,
  units,
  price,
}: {
  service: number;
  units: number;
  price: number;
}) {
  const [link, setLink] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const [confirmed, setConfirmed] = useState("");
  return (
    <>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!db || busy || done) return;
          setBusy(true);
          try {
            const user = (await db.auth.getSession()).data.session?.user;
            if (!user) throw Error("Sign in before requesting an order.");
            const storageKey = JSON.stringify([
              "voxx-request",
              user.id,
              service,
              units,
              link,
              price,
            ]);
            const token =
              sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
            sessionStorage.setItem(storageKey, token);
            const { data, error } = await db.rpc("voxx_request_order", {
              service_number: service,
              target_url: link,
              units,
              token,
              expected_total: Math.round((price * units) / 10) / 100,
            });
            if (error) throw error;
            sessionStorage.removeItem(storageKey);
            setDone(true);
            setConfirmed(data);
            setMessage("Order " + data + " confirmed. Payment is covered by your live wallet.");
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Campaign URL
          <input
            type="url"
            required
            pattern="https://.*"
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setDone(false);
              setConfirmed("");
            }}
          />
        </label>
        <button disabled={busy || done}>Place order</button>
        {done && (
          <button
            type="button"
            onClick={() => {
              setDone(false);
              setConfirmed("");
              setMessage("");
            }}
          >
            Start another order
          </button>
        )}
        <p role="status">{message}</p>
      </form>
      {confirmed && (
        <ConfirmedProgress key={confirmed} id={confirmed} requested={units} />
      )}
    </>
  );
}
