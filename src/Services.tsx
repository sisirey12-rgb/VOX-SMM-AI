import { useEffect, useState } from "react";
import "./catalogue.css";
import { Schedule } from "./Controls";
import { operation, OrderForm } from "./Orders";
import { db, money, preview, type Service, type Catalogue } from "./catalogue";
import { Loading } from "./UltraGlass";

export function Services({
  manage = false,
  campaign = false,
  openBundles,
}: {
  manage?: boolean;
  campaign?: boolean;
  openBundles?: () => void;
}) {
  const [data, setData] = useState<Catalogue | null>(db ? null : preview);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, reload] = useState(0);
  const [query, search] = useState(""),
    [category, filter] = useState(""),
    [choice, select] = useState<number | null>(null);
  const [quantity, setQuantity] = useState(""),
    [busy, setBusy] = useState(false),
    [markup, setMarkup] = useState("");
  const [page, setPage] = useState(0),
    [draft, setDraft] = useState(false);
  const [pacingService, setPacingService] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    if (db) {
      setData(null);
      setError("");
      db.rpc("voxx_catalogue", { manage }).then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setError("Catalogue unavailable. Check your connection and retry.");
          return;
        }
        const result = data as Catalogue;
        setData(result);
        setMarkup(String(result.markup ?? ""));
        select(null);
        setPage(0);
      });
    }
    return () => {
      active = false;
    };
  }, [manage, revision]);
  async function save(
    action: () => PromiseLike<{ error: unknown }>,
    message: string,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (result.error) throw result.error;
      setNotice(message);
      reload((n) => n + 1);
    } catch {
      setError(
        "Action failed. Check admin access, configuration and input values.",
      );
    } finally {
      setBusy(false);
    }
  }
  const list = (data?.items ?? []).filter(
    (s) =>
      (!category || s.category === category) &&
      [s.name, s.category, s.type, String(s.id)].some((v) =>
        v.toLowerCase().includes(query.trim().toLowerCase()),
      ),
  );
  const selected = list.find((s) => s.id === choice);
  const [delivery, setDelivery] = useState<"single" | "schedule">(
    campaign ? "schedule" : "single",
  );
  const serviceId = selected?.id;
  const selectedType = selected?.type;
  const source = data?.source;
  const automatic = pacingService !== null && pacingService === serviceId;
  useEffect(() => {
    setPacingService(null);
    if (manage || !db || source !== "live" || selectedType !== "Default" || serviceId === undefined)
      return;
    let active = true;
    db.from("voxx_pacing").select("enabled").eq("service_id", serviceId).maybeSingle()
      .then(({ data, error }) => {
        if (active && !error && data?.enabled) {
          setPacingService(serviceId);
          setDelivery("schedule");
        }
      });
    return () => { active = false; };
  }, [manage, source, selectedType, serviceId]);
  const scheduled =
    source === "live" && (campaign || draft || automatic) && delivery === "schedule";
  const valid =
    selected &&
    quantity !== "" &&
    Number.isSafeInteger(+quantity) &&
    +quantity >= selected.min &&
    +quantity <= selected.max;
  function pick(s: Service) {
    select(s.id);
    setQuantity(String(s.min));
    setDraft(false);
    if (s.id !== choice) setDelivery(campaign ? "schedule" : "single");
    if (window.matchMedia("(max-width:1050px)").matches)
      requestAnimationFrame(() =>
        document
          .getElementById("service-details")
          ?.scrollIntoView({ block: "start" }),
      );
  }
  return (
    <div className="catalog">
      {error && (
        <div role="alert" className="notice">
          {error} <button onClick={() => reload((n) => n + 1)}>Retry</button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {data ? (
        <>
          <div className="catalog-heading">
            <div>
              <small className="eyebrow">
                {data.source === "mock"
                  ? "MOCK CATALOGUE"
                  : "SMMXPERT CATALOGUE"}
              </small>
              <h2>{manage ? "Manage services" : "Find a service"}</h2>
            </div>
            <span>{data.items.length} services</span>
          </div>
          {!manage && openBundles && (
            <button className="glass-action" type="button" onClick={openBundles}>Browse Smart Bundles</button>
          )}
          {manage && (
            <form
              className="panel admin-tools"
              onSubmit={(e) => {
                e.preventDefault();
                void save(
                  () => db!.rpc("voxx_markup", { percent_value: +markup }),
                  "Default markup saved.",
                );
              }}
            >
              <label>
                Default markup (%)
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  max="1000"
                  value={markup}
                  onChange={(e) => setMarkup(e.target.value)}
                />
              </label>
              <button disabled={busy}>Save markup</button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  save(async () => {
                    await operation("sync");
                    return { error: null };
                  }, "Provider catalogue synced.")
                }
              >
                Sync live catalogue
              </button>
            </form>
          )}
          <div className="catalog-layout">
            <section className="panel">
              <div className="filters">
                <label>
                  Search services
                  <input
                    type="search"
                    placeholder="Name, type or ID"
                    value={query}
                    onChange={(e) => {
                      search(e.target.value);
                      setPage(0);
                      select(null);
                    }}
                  />
                </label>
                <label>
                  Platform or category
                  <select
                    value={category}
                    onChange={(e) => {
                      filter(e.target.value);
                      setPage(0);
                      select(null);
                    }}
                  >
                    <option value="">All categories</option>
                    {Array.from(new Set(data.items.map((s) => s.category)))
                      .sort()
                      .map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                  </select>
                </label>
              </div>
              <p aria-live="polite">{list.length} matching services</p>
              {list.slice(page * 24, page * 24 + 24).map((s) => (
                <button
                  className="service"
                  aria-pressed={s.id === choice}
                  key={s.id}
                  onClick={() => pick(s)}
                >
                  <div>
                    <small>
                      {s.category} · #{s.id} · {s.type}
                      {s.visible === false ? " · Hidden" : ""}
                    </small>
                    <strong>{s.name}</strong>
                  </div>
                  <span>
                    {money(s.price)}
                    <small>
                      {s.type === "Default" ? " / 1,000" : "listed rate"}
                    </small>
                  </span>
                </button>
              ))}
              {!list.length && <p>Try another name or category.</p>}
              {list.length > 24 && (
                <div className="pager">
                  <button disabled={!page} onClick={() => setPage(page - 1)}>
                    Previous
                  </button>{" "}
                  {page + 1} / {Math.ceil(list.length / 24)}{" "}
                  <button
                    disabled={(page + 1) * 24 >= list.length}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
            <section id="service-details" className="panel detail">
              <small className="eyebrow">SERVICE DETAILS</small>
              {selected ? (
                <>
                  <h3>{selected.name}</h3>
                  <p>
                    {selected.type} · #{selected.id}
                  </p>
                  <p>
                    Quantity range {selected.min.toLocaleString()} –{" "}
                    {selected.max.toLocaleString()}
                  </p>
                  <p>
                    Refill {selected.refill ? "available" : "unavailable"} ·
                    Cancellation {selected.cancel ? "available" : "unavailable"}
                  </p>
                  {manage ? (
                    <Editor
                      key={selected.id}
                      service={selected}
                      busy={busy}
                      onSave={(fixed, visible) =>
                        save(
                          () =>
                            db!.rpc("voxx_price", {
                              expected_source: data.source,
                              service_id: selected.id,
                              retail: fixed,
                              listed: visible,
                            }),
                          "Service updated.",
                        )
                      }
                    />
                  ) : (
                    <>
                      {selected.type === "Default" &&
                        data.source === "live" &&
                        (campaign || draft || automatic) && (
                          <label>
                            Order type
                            <select
                              value={delivery}
                              onChange={(e) =>
                                setDelivery(
                                  e.target.value as "single" | "schedule",
                                )
                              }
                            >
                              <option value="schedule">
                                {automatic ? "Automatic drip schedule" : "Scheduled campaign"}
                              </option>
                              <option value="single">Single order</option>
                            </select>
                          </label>
                        )}
                      {selected.type === "Default" ? (
                        scheduled ? (
                          <Schedule
                            key={selected.id}
                            service={selected.id}
                            minimum={selected.min}
                            maximum={selected.max}
                            price={selected.price}
                          />
                        ) : (
                          <>
                            <label>
                              Quantity
                              <input
                                type="number"
                                step="1"
                                min={selected.min}
                                max={selected.max}
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                              />
                            </label>
                            <p aria-live="polite">
                              {valid
                                ? "Estimated total " +
                                  money(
                                    Math.round(
                                      (selected.price * +quantity) / 10,
                                    ) / 100,
                                  )
                                : "Enter a whole quantity within the listed range."}
                            </p>
                          </>
                        )
                      ) : (
                        <p>
                          Listed rate {money(selected.price)}. This service has
                          type-specific order requirements.
                        </p>
                      )}
                      {!campaign && !draft && !automatic && selected.type === "Default" && data.source === "live" && (
                        <button
                          onClick={() => {
                            setDelivery("schedule");
                            setDraft(true);
                          }}
                        >
                          Use in campaign
                        </button>
                      )}
                      {data.source === "live" &&
                      !scheduled &&
                      valid &&
                      (campaign || draft) &&
                      selected.type === "Default" ? (
                        <>
                          <OrderForm
                            key={[selected.id, quantity].join("-")}
                            service={selected.id}
                            units={+quantity}
                            price={selected.price}
                          />
                        </>
                      ) : scheduled ? null : (
                        <p>
                          {data.source === "mock"
                            ? "Preview catalogue. Orders are disabled."
                            : "Only approved default services accept order requests."}
                        </p>
                      )}
                    </>
                  )}
                </>
              ) : (
                <>
                  <h3>Select a service</h3>
                  <p>Choose a catalogue entry to see its price and limits.</p>
                </>
              )}
            </section>
          </div>
        </>
      ) : (
        !error && <Loading label="Loading catalogue" />
      )}
    </div>
  );
}

function Editor({
  service,
  busy,
  onSave,
}: {
  service: Service;
  busy: boolean;
  onSave: (fixed: number | null, visible: boolean) => void;
}) {
  const [rate, setRate] = useState(String(service.fixed ?? "")),
    [visible, setVisible] = useState(!!service.visible);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(rate === "" ? null : Number(rate), visible);
      }}
    >
      <p>Provider rate {money(service.cost!)}</p>
      <label>
        Fixed retail rate (₹)
        <input
          type="number"
          step="0.0001"
          min="0"
          max="1000000000000"
          value={rate}
          placeholder="Use default markup"
          onChange={(e) => setRate(e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={visible}
          onChange={(e) => setVisible(e.target.checked)}
        />{" "}
        List for customers
      </label>
      <button disabled={busy}>Save service</button>
    </form>
  );
}
