import { useEffect, useState } from "react";
import { db, money, type Catalogue } from "./catalogue";

type Component = { service_id: number; quantity: number };
type Bundle = { id: string; name: string; platform: string; components: Component[] };
type Platform = { category: string; platform: string };
type Booking = {
  id: string;
  name: string;
  start_at: string;
  components: { id: string; name: string; state: string }[];
};
type Quote = {
  pace: string;
  minutes: number | null;
  total: number;
  duration: number;
  parts: {
    service_id: number;
    name: string;
    quantity: number;
    plan: { fastFee?: number; batches: { offset: number; quantity: number }[] };
  }[];
};

export function Bundles({ manage, user }: { manage: boolean; user?: string }) {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [platform, setPlatform] = useState("");
  const [parts, setParts] = useState<Component[]>([]);
  const [editing, setEditing] = useState<Bundle | null>(null);
  const [choice, setChoice] = useState("");
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [pace, setPace] = useState("slow");
  const [seed, setSeed] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [booking, setBooking] = useState("");
  const [history, setHistory] = useState<Booking[]>([]);
  const [revision, refresh] = useState(0);

  useEffect(() => {
    if (!db || !user) return;
    let active = true;
    db.from("voxx_bundles").select("*").order("name").then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage(error.message);
      else setBundles(data ?? []);
    });
    if (manage) {
      db.rpc("voxx_catalogue", { manage: true }).then(({ data, error }) => {
        if (!active) return;
        if (error) setMessage(error.message);
        else setCatalogue(data as Catalogue);
      });
      db.from("voxx_bundle_categories").select("*").then(({ data, error }) => {
        if (!active) return;
        if (error) setMessage(error.message);
        else setPlatforms(data ?? []);
      });
    }
    if (!manage) {
      db.rpc("voxx_my_bundles").then(({ data, error }) => {
        if (!active) return;
        if (error) setMessage(error.message);
        else setHistory(data ?? []);
      });
    }
    return () => { active = false; };
  }, [manage, user, revision]);

  if (!user || !db) return <p>Sign in to browse Smart Bundles.</p>;
  const client = db;
  const services = catalogue?.source === "live" ? catalogue.items : [];
  const assignable = services.filter((service) =>
    service.visible && service.type === "Default" &&
    platforms.some((item) => item.category === service.category && item.platform === platform),
  );
  const availablePlatforms = [...new Set(platforms.map((item) => item.platform))].sort();
  const quote = quotes[pace];
  const fastFee = quote?.parts.reduce((total, part) => total + (part.plan.fastFee ?? 0), 0) ?? 0;
  const recommended = quotes.slow ? "slow" : quotes.medium ? "medium" : null;

  return (
    <section className="panel form-panel catalog">
      <h2>Smart Bundles</h2>
      {manage ? (
        <>
          <form onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const result = await client.from("voxx_bundle_categories").upsert({
              category: String(data.get("category")),
              platform: String(data.get("platform")).trim().toLowerCase(),
            });
            setMessage(result.error?.message ?? "Category assigned.");
            if (!result.error) refresh((value) => value + 1);
          }}>
            <h3>Provider category platforms</h3>
            <label>Provider category
              <select name="category" required>
                <option value="">Choose a category</option>
                {[...new Set(services.map((service) => service.category))].sort().map((category) =>
                  <option key={category}>{category}</option>,
                )}
              </select>
            </label>
            <label>Platform <input name="platform" placeholder="youtube" required maxLength={50} /></label>
            <button>Assign category</button>
          </form>
          <form key={editing?.id ?? "new"} onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const values = { name: String(data.get("name")).trim(), platform, components: parts };
            const result = editing
              ? await client.from("voxx_bundles").update(values).eq("id", editing.id)
              : await client.from("voxx_bundles").insert(values);
            setMessage(result.error?.message ?? "Bundle saved.");
            if (!result.error) refresh((value) => value + 1);
          }}>
            <h3>{editing ? "Edit bundle" : "New bundle"}</h3>
            <label>Name <input name="name" defaultValue={editing?.name} required maxLength={100} /></label>
            <label>Platform
              <select required value={platform} onChange={(event) => {
                setPlatform(event.target.value);
                setParts([]);
              }}>
                <option value="">Choose a platform</option>
                {availablePlatforms.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            {assignable.map((service) => {
              const part = parts.find((item) => item.service_id === service.id);
              return <div key={service.id}>
                <label>
                  <input type="checkbox" checked={!!part} disabled={!part && parts.length >= 6}
                    onChange={(event) => setParts(event.target.checked
                      ? [...parts, { service_id: service.id, quantity: service.min }]
                      : parts.filter((item) => item.service_id !== service.id))} />
                  {service.name}
                </label>
                {part && <label>Quantity for {service.name}
                  <input type="number" min={1} required value={part.quantity}
                    onChange={(event) => setParts(parts.map((item) => item.service_id === service.id
                      ? { ...item, quantity: Number(event.target.value) } : item))} />
                </label>}
              </div>;
            })}
            <button disabled={parts.length < 2}>Save bundle</button>
            {editing && <button type="button" onClick={() => {
              setEditing(null);
              setPlatform("");
              setParts([]);
            }}>New bundle</button>}
          </form>
          {bundles.map((item) => <p key={item.id}>
            {item.name} · {item.platform} · {item.components.length} services{" "}
            <button onClick={() => {
              setEditing(item);
              setPlatform(item.platform);
              setParts(item.components);
            }}>Edit</button>
          </p>)}
        </>
      ) : (
        <>
          <form onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setMessage("");
            setQuotes({});
            setBooking("");
            const form = new FormData(event.currentTarget);
            const minutes = Number(form.get("minutes"));
            const id = crypto.randomUUID();
            const options = minutes > 0 ? ["slow", "medium", "custom"] : ["slow", "medium"];
            try {
              const results = await Promise.all(options.map(async (option) => ({
                option,
                result: await client.rpc("voxx_bundle_quote", {
                  bundle: choice, pace: option, minutes: option === "custom" ? minutes : null, seed: id,
                }),
              })));
              const next = Object.fromEntries(results.flatMap(({ option, result }) =>
                result.error ? [] : [[option, result.data as Quote]],
              ));
              setSeed(id);
              setQuotes(next);
              if (next.slow) setPace("slow");
              else if (next.medium) setPace("medium");
              else if (next.custom) setPace("custom");
              else setMessage(results[0]?.result.error?.message ?? "No valid schedule is available.");
            } finally {
              setBusy(false);
            }
          }}>
            <label>Bundle
              <select value={choice} required disabled={busy} onChange={(event) => {
                setChoice(event.target.value);
                setQuotes({});
                setBooking("");
                setMessage("");
              }}>
                <option value="">Choose a bundle</option>
                {bundles.map((item) => <option key={item.id} value={item.id}>
                  {item.name} ({item.platform})
                </option>)}
              </select>
            </label>
            <label>Custom duration in minutes (optional) <input name="minutes" type="number" min={1} /></label>
            <button disabled={!choice || busy}>Compare paces</button>
          </form>
          {quote && <form onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            setBusy(true);
            setMessage("");
            try {
              const { data, error } = await client.rpc("voxx_book_bundle", {
                bundle: choice,
                seed,
                target_url: String(form.get("target")).trim(),
                start_time: new Date(String(form.get("start"))).toISOString(),
                accepted: quote,
              });
              if (error) setMessage(error.message);
              else {
                setBooking(String(data));
                refresh((value) => value + 1);
              }
            } finally {
              setBusy(false);
            }
          }}>
            <label>Pace
              <select value={pace} disabled={busy || !!booking} onChange={(event) => setPace(event.target.value)}>
                {Object.keys(quotes).map((option) => <option key={option} value={option}>
                  {option === "slow" ? "Slow" : option === "medium" ? "Medium" : "Custom"}
                  {option === recommended ? " · System recommended" : ""}
                </option>)}
              </select>
            </label>
            {fastFee > 0 && <p>Includes {money(fastFee)} in faster pace fees.</p>}
            <p>{money(quote.total)} total · {quote.duration} planned minutes</p>
            {quote.parts.map((part) => <details key={part.service_id}>
              <summary>{part.name} · {part.quantity} units · {part.plan.batches.length} batches</summary>
              {part.plan.batches.map((batch, index) => <p key={index}>
                +{batch.offset} min · {batch.quantity} units
              </p>)}
            </details>)}
            <label>Shared target URL <input name="target" type="url" required disabled={busy || !!booking} /></label>
            <label>Shared start time <input name="start" type="datetime-local" required disabled={busy || !!booking} /></label>
            <button disabled={busy || !!booking}>Confirm funded bundle</button>
          </form>}
          {booking && <p role="status">Bundle confirmed. Reference {booking}.</p>}
          {history.length > 0 && (
            <section>
              <h3>My bundles</h3>
              <button type="button" onClick={() => refresh((value) => value + 1)}>
                Refresh bundle status
              </button>
              {history.map((item) => <article key={item.id}>
                <h4>{item.name}</h4>
                <p>Scheduled start {new Date(item.start_at).toLocaleString()}</p>
                <ul>
                  {item.components.map((component) => <li key={component.id}>
                    <a href={"?order=" + component.id}>{component.name}</a> · {component.state}
                  </li>)}
                </ul>
              </article>)}
            </section>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
