import { useEffect, useState, type FormEvent } from "react";
import { db, money } from "./catalogue";
import { RecordTable } from "./RecordTable";
import { Loading } from "./UltraGlass";

type Row = Record<string, string | number | null>;
const views: Record<string, [string, string]> = {
  "Website settings": ["voxx_site", "welcome,created_at"],
  "Worker health": ["voxx_worker_health", "name,created_at"],
  Currency: ["voxx_fx", "currency,inr_per_unit,created_at"],
  Notifications: ["voxx_notices", "id,title,body,created_at"],
  "Sync history": ["voxx_sync_log", "imported,created_at"],
  "My customers": ["voxx_profiles", "id,display_name,role,created_at"],
  Storefronts: ["voxx_stores", "id,name,owner_id,created_at"],
  "Wallet ledger": ["voxx_ledger", "owner_id,reference,mode,paise,created_at"],
  Customers: [
    "voxx_profiles",
    "id,display_name,role,pricing_tier,parent_id,created_at",
  ],
  Support: ["voxx_tickets", "subject,body,reply,state,id,created_at"],
  Payments: ["voxx_payments", "id,paise,state,mode,created_at"],
  Wallet: ["voxx_ledger", "paise,reference,created_at"],
  Audit: ["voxx_audit", "entity,operation,actor,created_at"],
};
type Checkout = new (options: Record<string, unknown>) => { open(): void };
declare global {
  interface Window {
    Razorpay?: Checkout;
  }
}
async function checkout(amount: number) {
  const token = (await db!.auth.getSession()).data.session?.access_token;
  const response = await fetch("/api/payment", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ amount }),
  });
  const order = await response.json();
  if (!response.ok) throw Error(order.error || "Payment unavailable");
  if (!window.Razorpay)
    await new Promise<void>((ok, fail) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => ok();
      script.onerror = () => fail(Error("Checkout unavailable"));
      document.head.appendChild(script);
    });
  if (!window.Razorpay) throw Error("Checkout unavailable");
  new window.Razorpay({
    ...order,
    name: "VOXX",
    description: order.mode + " wallet deposit",
    theme: { color: "#8046ef" },
  }).open();
}
export function Workspace({ page, user, admin }: { page: string; user: string; admin: boolean }) {
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState("test");
  const [rows, show] = useState<Row[]>([]),
    [message, tell] = useState(""),
    [version, reload] = useState(0),
    [balance, setBalance] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [role, setRole] = useState("");
  useEffect(() => {
    let active = true;
    if (!db || !user) return;
    async function load() {
      const roleReply = await db!.rpc("voxx_role");
      if (active) setRole(roleReply.data ?? "");
      if (page === "Analytics") {
        const states = [
          "Awaiting review",
          "Submitted",
          "Closed",
          "Needs reconciliation",
        ];
        const summary = await Promise.all(
          states.map(async (state) => {
            const r = await db!
              .from("voxx_orders")
              .select("id", { count: "exact", head: true })
              .eq("state", state);
            if (r.error) throw r.error;
            return { state, count: r.count ?? 0 };
          }),
        );
        if (active) show(summary);
        return;
      }
      const [table, columns] = views[page];
      let q = db!
        .from(table)
        .select(columns)
        .order("created_at", { ascending: false })
        .limit(100);
      if (page === "My customers") q = q.eq("parent_id", user);
      if (
        page === "Payments" &&
        !["admin", "super_admin", "finance"].includes(roleReply.data)
      )
        q = q.eq("owner_id", user);
      if (page === "Wallet") {
        const conf = await fetch("/api/payment")
          .then((r) => r.json())
          .catch(() => ({ mode: "test" }));
        const walletMode = conf.mode === "live" ? "live" : "test";
        if (active) setMode(walletMode);
        q = q.eq("owner_id", user).eq("mode", walletMode);
        const b = await db!.rpc("voxx_balance", { wallet_mode: walletMode });
        if (b.error) throw b.error;
        if (active) setBalance(Number(b.data));
      }
      const r = await q;
      if (r.error) throw r.error;
      if (active) show((r.data ?? []) as unknown as Row[]);
    }
    load().catch(() => {
      if (active)
        tell("Records unavailable. Check your connection and permissions.");
    }).finally(() => {
      if (active) setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [page, user, version]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!db) return;
    const form = e.currentTarget,
      data = new FormData(form);
    setBusy(true);
    tell("");
    try {
      if (page === "Wallet") {
        await checkout(Math.round(Number(data.get("rupees")) * 100));
        tell("Refresh after the payment webhook arrives.");
      }
      if (page === "Support") {
        const r = data.get("ticket")
          ? await db
              .from("voxx_tickets")
              .update({ reply: data.get("reply"), state: "Closed" })
              .eq("id", data.get("ticket"))
              .select("id")
              .single()
          : await db
              .from("voxx_tickets")
              .insert({ subject: data.get("subject"), body: data.get("body") });
        if (r.error) throw r.error;
      }
      if (page === "Currency") {
        const r = await db.from("voxx_fx").upsert({
          currency: String(data.get("currency")).toUpperCase(),
          inr_per_unit: Number(data.get("rate")),
          created_at: new Date().toISOString(),
        });
        if (r.error) throw r.error;
      }
      if (page === "Website settings") {
        const r = await db
          .from("voxx_site")
          .update({ welcome: data.get("welcome") })
          .eq("id", true);
        if (r.error) throw r.error;
      }
      if (page === "Notifications" && admin) {
        const r = await db
          .from("voxx_notices")
          .insert({
            title: String(data.get("title")).trim(),
            body: String(data.get("body")).trim(),
          });
        if (r.error) throw r.error;
        tell("Notification published. Customers can read it in Notifications.");
      }
      if (page === "Customers" && data.has("tier")) {
        const r = await db.rpc("voxx_assign_tier", {
          person: data.get("person"),
          tier: data.get("tier"),
        });
        if (r.error) throw r.error;
      } else if (page === "Customers") {
        const r = await db.rpc("voxx_manage_role", {
          person: data.get("person"),
          new_role: data.get("role"),
          parent: data.get("parent") || null,
        });
        if (r.error) throw r.error;
      }
      form.reset();
      reload((v) => v + 1);
    } catch (e) {
      tell((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!user) return <p>Sign in to access {page.toLowerCase()}.</p>;
  return (
    <section className="panel catalog form-panel space-y-4">
      {page === "Currency" && (
        <form onSubmit={submit}>
          <label>
            Provider currency
            <input name="currency" required pattern="[A-Za-z]{3}" />
          </label>
          <label>
            INR per currency unit
            <input
              type="number"
              step="any"
              min="0.00000001"
              name="rate"
              required
            />
          </label>
          <button disabled={busy}>Save exchange rate</button>
        </form>
      )}
      {page === "Website settings" && (
        <form onSubmit={submit}>
          <label>
            Homepage headline
            <input name="welcome" required maxLength={100} />
          </label>
          <button disabled={busy}>Save headline</button>
        </form>
      )}
      {page === "Notifications" && admin && ["super_admin", "admin"].includes(role) && (
        <form className="notification-composer" onSubmit={submit}>
          <h2>Publish a customer notification</h2>
          <label>
            Title
            <input name="title" maxLength={200} required />
          </label>
          <label>
            Message
            <textarea name="body" rows={10} maxLength={4000} required />
          </label>
          <button disabled={busy}>{busy ? "Publishing…" : "Publish to customers"}</button>
        </form>
      )}
      {page === "Wallet" && (
        <>
          <h3>
            {mode === "test" ? "Test wallet balance" : "Wallet balance"}{" "}
            {balance === null ? "Unavailable" : money(balance / 100)}
          </h3>
          <p>{mode === "test" ? "Test funds cannot pay for live orders." : "Use wallet funds to pay for orders and campaigns. Deposits appear after Razorpay confirms payment."}</p>
          <h3>Add funds</h3>
          <form onSubmit={submit}>
            <label>
              Deposit amount (INR)
              <input
                type="number"
                name="rupees"
                min="1"
                max="100000"
                step=".01"
                required
              />
            </label>
            <button disabled={busy}>{mode === "test" ? "Add test funds" : "Add funds with Razorpay"}</button>
          </form>
        </>
      )}
      {page === "Support" && (
        <form onSubmit={submit}>
          <label>
            Subject
            <input required minLength={2} maxLength={160} name="subject" />
          </label>
          <label>
            Message
            <textarea required minLength={2} maxLength={5000} name="body" />
          </label>
          <button disabled={busy}>Open ticket</button>
        </form>
      )}
      {page === "Customers" && ["admin", "super_admin"].includes(role) && (
        <form onSubmit={submit}>
          <label>
            Account UUID
            <input required name="person" />
          </label>
          <label>
            Pricing tier
            <input name="tier" placeholder="Use account role by default" />
          </label>
          <button disabled={busy}>Assign pricing tier</button>
        </form>
      )}
      {page === "Customers" && role === "super_admin" && (
        <form onSubmit={submit}>
          <label>
            Account UUID
            <input required name="person" />
          </label>
          <label>
            Role
            <select name="role">
              {[
                "customer",
                "reseller",
                "finance",
                "support",
                "admin",
                "super_admin",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Parent reseller UUID (optional)
            <input name="parent" />
          </label>
          <button disabled={busy}>Save access</button>
        </form>
      )}
      {page === "Payments" && <p>Payment history shows wallet top-ups made through Razorpay and their status. Use Wallet to add funds and see your balance.</p>}
      {page === "My customers" && <p>These are accounts linked to your reseller account, such as customers who joined through your storefront.</p>}
      <p role="status">{message}</p>
      <button onClick={() => reload((v) => v + 1)}>Refresh records</button>
      {!loaded && db && user ? (
        <Loading label="Loading records" />
      ) : rows.length === 0 ? (
        <p>{page === "Support" ? "No support tickets yet. Send a request above if you need help with an order or your account." : page === "Notifications" ? "No announcements yet." : "No records to display."}</p>
      ) : page === "Notifications" ? (
        <ul className="notification-feed" aria-label="Published notifications">
          {rows.map((row) => (
            <li key={row.id}>
              <h3>{row.title}</h3>
              {typeof row.created_at === "string" && (
                <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time>
              )}
              <p>{row.body}</p>
            </li>
          ))}
        </ul>
      ) : (
        <RecordTable rows={rows} title={page} />
      )}
      {page === "Payments" && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const id = String(new FormData(e.currentTarget).get("order"));
            try {
              const t = (await db!.auth.getSession()).data.session
                ?.access_token;
              const r = await fetch("/api/payment", {
                method: "POST",
                headers: {
                  Authorization: "Bearer " + t,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ reconcile: id }),
              });
              const j = await r.json();
              tell(j.status ?? j.error);
              reload((v) => v + 1);
            } catch {
              tell("Reconciliation unavailable.");
            }
          }}
        >
          <label>
            Your gateway order ID
            <input name="order" required />
          </label>
          <button>Check gateway payment</button>
        </form>
      )}
      {page === "Support" &&
        ["support", "admin", "super_admin"].includes(role) &&
        rows.some((r) => r.state === "Open") && (
          <form onSubmit={submit}>
            <label>
              Ticket
              <select name="ticket">
                {rows
                  .filter((r) => r.state === "Open")
                  .map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.subject}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Resolution
              <textarea name="reply" required />
            </label>
            <button disabled={busy}>Reply and close</button>
          </form>
        )}
    </section>
  );
}
