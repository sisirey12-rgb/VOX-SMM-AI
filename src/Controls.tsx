import { useEffect, useState } from "react";
import { PaceAdmin, PacedForm } from "./Pacing";
import { ConfirmedProgress } from "./ProgressGraph";
import { db, money } from "./catalogue";
export function Rules({ schedule }: { schedule: boolean }) {
  const [rows, setRows] = useState<Record<string, string | number>[]>([]),
    [msg, tell] = useState(""),
    [v, refresh] = useState(0);
  const table = schedule ? "voxx_schedule_rules" : "voxx_rules";
  useEffect(() => {
    let active = true;
    db?.from(table)
      .select("*")
      .then((r) => {
        if (active) {
          setRows(r.data ?? []);
          if (r.error) tell(r.error.message);
        }
      });
    return () => {
      active = false;
    };
  }, [v, table]);
  return (
    <section className="panel form-panel catalog">
      <h3>{schedule ? "Verified campaign services" : "Pricing rules"}</h3>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const data = Object.fromEntries(new FormData(form));
          const r = await db!.from(table).upsert(data);
          tell(r.error?.message ?? "Rule saved.");
          if (!r.error) form.reset();
          refresh(v + 1);
        }}
      >
        {schedule ? (
          <>
            <p>
              Add a service only after confirming separate orders to the same
              target are permitted and billed independently. Each run places one
              order.
            </p>
            {[
              ["service_id", "Service ID", 1],
              ["min_minutes", "Minimum interval (minutes)", 1],
              ["max_minutes", "Maximum interval (minutes)", 1],
              ["max_runs", "Maximum runs", 1],
              ["fee_inr", "Campaign fee (INR)", 0],
            ].map(([k, label, min]) => (
              <label key={k}>
                {label}
                <input
                  required
                  type="number"
                  name={String(k)}
                  min={min}
                  step={k === "fee_inr" ? ".01" : "1"}
                />
              </label>
            ))}
            <label>
              Provider confirmation reference
              <input required minLength={20} name="evidence" />
            </label>
          </>
        ) : (
          <>
            <label>
              Rule
              <select name="scope">
                {["category", "service", "discount", "margin"].map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label>
              Applies to
              <input name="selector" required />
            </label>
            <p>
              Use the exact category, live/service ID (for example live/42),
              account role or pricing tier, or global for the minimum margin.
            </p>
            <label>
              Percentage
              <input name="value" type="number" step=".01" min="0" required />
            </label>
          </>
        )}
        <button>Save rule</button>
      </form>
      <p role="status">{msg}</p>
      {rows.map((r) => (
        <article
          className="panel"
          key={String(r.service_id ?? r.scope + "/" + r.selector)}
        >
          <p>
            {schedule
              ? "Service " +
                r.service_id +
                " · " +
                r.min_minutes +
                "–" +
                r.max_minutes +
                " minutes · " +
                r.max_runs +
                " runs"
              : r.scope + " · " + r.selector + " · " + r.value + "%"}
          </p>
          {schedule && <PaceAdmin service={Number(r.service_id)} />}
          <button
            onClick={async () => {
              let q = db!.from(table).delete();
              q = schedule
                ? q.eq("service_id", r.service_id)
                : q.eq("scope", r.scope).eq("selector", r.selector);
              const result = await q;
              tell(result.error?.message ?? "Rule removed.");
              refresh(v + 1);
            }}
          >
            Remove rule
          </button>
        </article>
      ))}
    </section>
  );
}
type Rule = {
  min_minutes: number;
  max_minutes: number;
  max_runs: number;
  fee_inr: number;
};
export function Schedule({
  service,
  minimum,
  maximum,
  price,
}: {
  service: number;
  minimum: number;
  maximum: number;
  price: number;
}) {
  const [mode, setMode] = useState("smart"),
    [confirmed, confirmOrder] = useState<{ id: string; units: number } | null>(
      null,
    );
  const [adaptive, setAdaptive] = useState<boolean | null | undefined>(
      undefined,
    ),
    [qty, setQty] = useState(String(Math.max(1, minimum)));
  const units = Number(qty);
  useEffect(() => {
    let active = true;
    db?.from("voxx_pacing")
      .select("enabled")
      .eq("service_id", service)
      .maybeSingle()
      .then((r) => {
        if (active) setAdaptive(r.error ? false : (r.data?.enabled ?? null));
      });
    return () => {
      active = false;
    };
  }, [service]);
  const [rule, setRule] = useState<Rule | null>(null),
    [msg, tell] = useState(""),
    [runs, setRuns] = useState(1),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    db?.from("voxx_schedule_rules")
      .select("min_minutes,max_minutes,max_runs,fee_inr")
      .eq("service_id", service)
      .maybeSingle()
      .then((r) => {
        if (active) setRule(r.data);
      });
    return () => {
      active = false;
    };
  }, [service]);
  if (adaptive === undefined) return <p>Loading pacing policy...</p>;
  if (!rule || adaptive === false)
    return <p>Scheduling is unavailable for this service.</p>;
  const quantityField = (
    <label>
      {adaptive && mode === "smart"
        ? "Total campaign quantity"
        : "Quantity per run"}
      <input
        required
        type="number"
        step="1"
        min={minimum}
        max={adaptive ? undefined : maximum}
        value={qty}
        onChange={(e) => setQty(e.target.value)}
      />
    </label>
  );
  if (
    !Number.isSafeInteger(units) ||
    units < 1 ||
    (!adaptive && (units < minimum || units > maximum))
  )
    return (
      <>
        {quantityField}
        <p>Enter a valid whole quantity.</p>
      </>
    );
  const selector = adaptive && (
    <label>
      Schedule mode
      <select value={mode} onChange={(e) => setMode(e.target.value)}>
        <option value="smart">Smart scheduling</option>
        <option value="manual">Manual advanced · fixed intervals</option>
      </select>
    </label>
  );
  if (adaptive && mode === "smart")
    return (
      <>
        {quantityField}
        {selector}
        <PacedForm service={service} units={units} />
      </>
    );
  const perRun = Math.round((price * units) / 10) / 100;
  return (
    <details open>
      <summary>Manual advanced scheduling</summary>
      {selector}
      {quantityField}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            const start = new Date(String(f.get("start"))).toISOString();
            const target = String(f.get("url"));
            const minutes = Number(f.get("minutes"));
            const user = (await db!.auth.getSession()).data.session?.user.id;
            if (!user) throw Error("Sign in required");
            const key = JSON.stringify([
              "campaign",
              user,
              service,
              start,
              target,
              minutes,
              runs,
              units,
              price,
              rule.fee_inr,
            ]);
            const token = sessionStorage.getItem(key) ?? crypto.randomUUID();
            sessionStorage.setItem(key, token);
            const r = await db!.rpc("voxx_schedule", {
              service_number: service,
              target_url: target,
              units,
              token,
              expected_total: perRun,
              start_at: start,
              minutes,
              runs,
              expected_fee: rule.fee_inr,
            });
            if (!r.error) {
              sessionStorage.removeItem(key);
              confirmOrder({ id: r.data, units: units * runs });
            }
            tell(r.error?.message ?? "Campaign sent for approval.");
          } catch (e) {
            tell((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Target URL
          <input name="url" type="url" pattern="https://.*" required />
        </label>
        <label>
          Start in your local time
          <input type="datetime-local" name="start" required />
        </label>
        <label>
          Runs
          <input
            type="number"
            min="1"
            max={rule.max_runs}
            required
            value={runs}
            onChange={(e) => setRuns(Number(e.target.value))}
          />
        </label>
        <label>
          Interval (minutes)
          <input
            type="number"
            name="minutes"
            min={rule.min_minutes}
            max={rule.max_minutes}
            defaultValue={rule.min_minutes}
            required
          />
        </label>
        <p>
          {units} units per run · {money(perRun * runs + Number(rule.fee_inr))}{" "}
          including {money(Number(rule.fee_inr))} scheduling fee.
        </p>
        <button disabled={busy}>Request campaign approval</button>
        <p>{msg}</p>
      </form>
      {confirmed && (
        <ConfirmedProgress
          key={confirmed.id}
          id={confirmed.id}
          requested={confirmed.units}
        />
      )}
    </details>
  );
}
type Campaign = {
  pacing_quote: {
    duration: number;
    total: number;
    pace: string;
    batches: { offset: number; quantity: number }[];
  } | null;
  id: string;
  service_id: number;
  state: string;
  runs: number;
  units: number;
  start_at: string;
};
export function Campaigns({ admin, user }: { admin: boolean; user: string }) {
  const [rows, setRows] = useState<Campaign[]>([]),
    [msg, tell] = useState(""),
    [v, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    if (db && user) {
      let q = db
        .from("voxx_campaigns")
        .select("id,service_id,state,runs,units,start_at,pacing_quote")
        .order("created_at", { ascending: false })
        .limit(100);
      if (!admin) q = q.eq("owner_id", user);
      q.then((r) => {
        if (active) {
          setRows(r.data ?? []);
          if (r.error) tell(r.error.message);
        }
      });
    }
    return () => {
      active = false;
    };
  }, [user, admin, v]);
  return (
    <section className="panel">
      <button onClick={() => refresh(v + 1)}>Refresh campaigns</button>
      <p role="status">{msg}</p>
      {!rows.length && <p>No campaigns to display.</p>}
      {rows.map((c) => (
        <article key={c.id}>
          <h3>Service #{c.service_id}</h3>
          <p>
            {c.state} ·{" "}
            {c.pacing_quote
              ? c.units +
                " units over " +
                c.pacing_quote.duration +
                " min  ·  " +
                c.pacing_quote.pace +
                "  ·  " +
                money(c.pacing_quote.total)
              : c.runs + " runs of " + c.units}{" "}
            · {new Date(c.start_at).toLocaleString()}
          </p>
          {c.pacing_quote && (
            <details>
              <summary>Quoted price and planned batches</summary>
              {c.pacing_quote.batches.map((b) => (
                <p key={b.offset}>
                  +{b.offset} min · {b.quantity} units
                </p>
              ))}
            </details>
          )}
          {[
            ...(admin && c.state === "Review" ? ["approve"] : []),
            ...(c.state === "Active" ? ["pause"] : []),
            ...(c.state === "Paused" ? ["resume"] : []),
            ...(["Active", "Paused", "Review"].includes(c.state)
              ? ["cancel"]
              : []),
          ].map((a) => (
            <button
              key={a}
              onClick={async () => {
                const r = await db!.rpc("voxx_campaign_state", {
                  campaign: c.id,
                  action: a,
                });
                tell(r.error?.message ?? "Updated");
                refresh(v + 1);
              }}
            >
              {a}
            </button>
          ))}
        </article>
      ))}
    </section>
  );
}
