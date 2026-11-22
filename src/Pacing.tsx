import { useEffect, useState } from "react";
import { ConfirmedProgress } from "./ProgressGraph";
import { db, money } from "./catalogue";
type Policy = {
  provider_capacity: number | null;
  service_id: number;
  enabled: boolean;
  slow_hourly: number;
  medium_hourly: number;
  batch_min: number;
  batch_max: number;
  target_gap: number;
  qty_variation: number;
  time_variation: number;
  max_duration: number;
  hourly_fee: number;
};
const fields: [
  Exclude<keyof Policy, "enabled" | "service_id" | "provider_capacity">,
  string,
  number,
  number,
][] = [
  ["slow_hourly", "Slow target (units per hour)", 1, 1000000000],
  ["medium_hourly", "Medium / fastest allowed (units per hour)", 2, 1000000000],
  ["batch_min", "Minimum units per batch", 1, 2147483647],
  ["batch_max", "Maximum units per batch", 1, 2147483647],
  ["target_gap", "Preferred spacing (minutes)", 1, 10080],
  ["qty_variation", "Batch size variation (%)", 0, 90],
  ["time_variation", "Interval variation (%)", 0, 90],
  ["max_duration", "Longest campaign (minutes)", 1, 525600],
  ["hourly_fee", "Scheduling price per hour (INR)", 0, 99999999],
];
export function PaceAdmin({ service }: { service: number }) {
  const [config, setConfig] = useState<Policy | null>(null),
    [message, tell] = useState(""),
    [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    db!
      .from("voxx_pacing")
      .select("*")
      .eq("service_id", service)
      .maybeSingle()
      .then((r) => {
        if (active) {
          setConfig(r.data);
          setReady(!r.error);
          if (r.error) tell(r.error.message);
        }
      });
    return () => {
      active = false;
    };
  }, [service]);
  return (
    <details>
      <summary>Configure variable pacing</summary>
      {ready && (
        <form
          key={String(config?.service_id)}
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            const data = Object.fromEntries(
              fields.map(([key]) => [key, Number(form.get(key))]),
            );
            if (
              data.medium_hourly <= data.slow_hourly ||
              data.batch_max < data.batch_min
            ) {
              tell("Medium must be faster than Slow. Check batch limits.");
              return;
            }
            const r = await db!
              .from("voxx_pacing")
              .upsert({
                ...data,
                service_id: service,
                enabled: form.has("enabled"),
                provider_capacity: form.get("capacity")
                  ? Number(form.get("capacity"))
                  : null,
              })
              .select()
              .single();
            if (!r.error) setConfig(r.data);
            tell(r.error?.message ?? "Pacing policy saved.");
          }}
        >
          <p>
            These limits work alongside the service’s verified interval and run
            limits. The campaign fee is charged once. The hourly fee uses the
            customer’s selected duration.
          </p>
          <label>
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={config?.enabled ?? true}
            />{" "}
            Enable variable schedules and dispatch
          </label>
          <label>
            Verified provider capacity (units/hour, optional)
            <input
              name="capacity"
              type="number"
              min="1"
              max="1000000000"
              defaultValue={config?.provider_capacity ?? ""}
            />
          </label>
          {fields.map(([key, label, min, max]) => (
            <label key={key}>
              {label}
              <input
                required
                type="number"
                name={key}
                min={min}
                max={max}
                step={key === "hourly_fee" ? ".01" : "1"}
                defaultValue={
                  config?.[key] ?? (key === "hourly_fee" ? 0 : undefined)
                }
              />
            </label>
          ))}
          <button>Save pacing policy</button>
        </form>
      )}
      <p role="status">{message}</p>
    </details>
  );
}
type Pace = "slow" | "medium" | "custom";
type Quote = {
  pace: Pace;
  duration: number;
  quantity: number;
  hourly: number;
  rate: number;
  subtotal: number;
  baseFee: number;
  hourFee: number;
  samples: number;
  capacity: number | null;
  fee: number;
  total: number;
  batches: { offset: number; quantity: number; amount: number }[];
};
function duration(minutes: number) {
  const h = Math.floor(minutes / 60),
    m = minutes % 60;
  return (
    [h ? h + " h" : "", m ? m + " min" : ""].filter(Boolean).join(" ") ||
    "0 min"
  );
}
export function PacedForm({
  service,
  units,
}: {
  service: number;
  units: number;
}) {
  const [pace, setPace] = useState<Pace>("slow"),
    [custom, setCustom] = useState("4"),
    [timeUnit, setTimeUnit] = useState(60),
    [seed, newSeed] = useState(() => crypto.randomUUID());
  const customMinutes = Number(custom) * timeUnit;
  const [quotes, setQuotes] = useState<Partial<Record<Pace, Quote>>>({}),
    [status, tell] = useState(""),
    [issue, setIssue] = useState(""),
    [loading, load] = useState(true),
    [busy, setBusy] = useState(false),
    [booked, setBooked] = useState(false),
    [rev, reload] = useState(0);
  useEffect(() => {
    let active = true;
    setQuotes({});
    setIssue("");
    tell("");
    load(true);
    setBooked(false);
    const modes: Pace[] =
      pace === "custom" ? ["slow", "medium", "custom"] : ["slow", "medium"];
    const timer = setTimeout(async () => {
      try {
        const next: Partial<Record<Pace, Quote>> = {};
        let why = "";
        await Promise.all(
          modes.map(async (key) => {
            if (key === "custom" && !Number.isSafeInteger(customMinutes)) {
              why = "Choose a duration in whole minutes.";
              return;
            }
            const r = await db!.rpc("voxx_paced_quote", {
              service_number: service,
              total_units: units,
              pace: key,
              requested_minutes: key === "custom" ? customMinutes : null,
              seed,
            });
            if (!r.error) next[key] = r.data;
            else if (key === pace) why = r.error.message;
          }),
        );
        if (active) {
          setQuotes(next);
          setIssue(why);
        }
      } catch {
        if (active) setIssue("Could not retrieve a quote.");
      } finally {
        if (active) load(false);
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [service, units, customMinutes, pace, seed, rev]);
  const q = quotes[pace];
  const ranked = (["slow", "medium"] as const)
    .filter((p) => quotes[p])
    .sort((a, b) => {
      if (pace !== "custom") return a === "slow" ? -1 : 1;
      return (
        Math.abs(quotes[a]!.duration - customMinutes) -
          Math.abs(quotes[b]!.duration - customMinutes) ||
        quotes[a]!.total - quotes[b]!.total
      );
    });
  const recommended = ranked[0];
  return (
    <section className="glass-scheduler" aria-label="Variable campaign pacing">
      <h3>Smart schedule</h3>
      <p>
        Choose how long VOXX spreads the order submissions. Times below are
        measured from the first batch.
      </p>
      <label>
        Pace
        <select
          aria-label="Pace"
          value={pace}
          onChange={(e) => setPace(e.target.value as Pace)}
        >
          <option value="slow">Slow</option>
          <option value="medium">Medium</option>
          <option value="custom">Choose my duration</option>
        </select>
      </label>
      {pace === "custom" && (
        <>
          <label>
            First to last batch
            <input
              type="number"
              min={1 / timeUnit}
              step="any"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          </label>
          <label>
            Duration unit
            <select
              value={timeUnit}
              onChange={(e) => setTimeUnit(Number(e.target.value))}
            >
              <option value="1">Minutes</option>
              <option value="60">Hours</option>
              <option value="1440">Days</option>
            </select>
          </label>
        </>
      )}
      {loading ? (
        <p role="status">Calculating schedules…</p>
      ) : (
        <>
          {(["slow", "medium"] as const).map((p) => {
            const option = quotes[p];
            return (
              option && (
                <p key={p}>
                  <strong>
                    {p === "slow" ? "Slow" : "Medium"}
                    {p === recommended
                      ? pace === "custom"
                        ? " · closest preset"
                        : " · recommended"
                      : ""}
                  </strong>{" "}
                  · {duration(option.duration)} · {option.hourly} units/hour ·{" "}
                  {money(option.total)}
                </p>
              )
            );
          })}
          {issue && <p role="alert">{issue}</p>}
          {q && (
            <>
              <h4>
                {q.quantity.toLocaleString()} units across {q.batches.length}{" "}
                batches
              </h4>
              <p>
                {duration(q.duration)} planned · {q.hourly} units/hour average
              </p>
              <p>
                Service rate {money(q.rate)} per 1,000 · service subtotal{" "}
                {money(q.subtotal)}. Scheduling {money(q.baseFee)} +{" "}
                {money(q.hourFee)}/hour = {money(q.fee)}.
              </p>
              <strong>Total {money(q.total)}</strong>
              <p>
                {q.capacity
                  ? "Verified provider ceiling: " + q.capacity + " units/hour. "
                  : ""}
                {q.samples >= 3
                  ? "Pacing uses recent verified completion times."
                  : "Pacing uses the configured service limits."}
              </p>
              <details>
                <summary>View batch times and quantities</summary>
                <table>
                  <thead>
                    <tr>
                      <th>From start</th>
                      <th>Units</th>
                      <th>Charge</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.batches.map((b) => (
                      <tr key={b.offset}>
                        <td>{duration(b.offset)}</td>
                        <td>{b.quantity}</td>
                        <td>{money(b.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (booked || busy) return;
                  const f = new FormData(e.currentTarget);
                  setBusy(true);
                  try {
                    const r = await db!.rpc("voxx_book_paced", {
                      service_number: service,
                      total_units: units,
                      pace,
                      requested_minutes:
                        pace === "custom" ? customMinutes : null,
                      seed,
                      target_url: String(f.get("url")),
                      start_time: new Date(
                        String(f.get("start")),
                      ).toISOString(),
                      accepted: q,
                    });
                    if (r.error) throw r.error;
                    setBooked(true);
                    tell("Campaign " + r.data + " is awaiting approval.");
                  } catch (e) {
                    tell((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Target URL
                  <input required name="url" type="url" pattern="https://.*" />
                </label>
                <label>
                  First batch (local time)
                  <input required name="start" type="datetime-local" />
                </label>
                <button disabled={busy || booked}>
                  Confirm {money(q.total)} schedule
                </button>
              </form>
            </>
          )}
          {!booked && (
            <button disabled={busy} onClick={() => reload((v) => v + 1)}>
              Refresh quote
            </button>
          )}
          {booked && (
            <ConfirmedProgress key={seed} id={seed} requested={units} />
          )}
          {booked && (
            <button onClick={() => newSeed(crypto.randomUUID())}>
              Start another campaign
            </button>
          )}
        </>
      )}
      <p role="status">{status}</p>
    </section>
  );
}
