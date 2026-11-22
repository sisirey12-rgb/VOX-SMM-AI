import { useEffect, useState } from "react";
import { db } from "./catalogue";
import { summarize, type History, type Point } from "./progress";
import { Status } from "./UltraGlass";
export function ProgressGraph({
  history,
  expanded = false,
}: {
  history: History;
  expanded?: boolean;
}) {
  const result = summarize(history),
    { points, last, counts } = result;
  const W = expanded ? 760 : 480,
    H = expanded ? 226 : 144,
    pad = 48,
    right = W - 12,
    bottom = H - 28,
    top = 16;
  const t0 = points[0].time,
    span = last.time - t0;
  const x = (p: Point) =>
    pad + (span ? ((p.time - t0) / span) * (right - pad) : 0);
  const y = (quantity: number) =>
    bottom - (quantity / history.requested) * (bottom - top);
  const path = (key: "submitted" | "accepted" | "completed") =>
    points
      .map((p, i) =>
        i ? "H" + x(p) + "V" + y(p[key]) : "M" + x(p) + " " + y(p[key]),
      )
      .join(" ");
  const pct = (n: number | null) => (n === null ? "—" : n.toFixed(1) + "%");
  const stamp = (t: number) =>
    new Date(t).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  return (
    <section aria-label="Recorded order progress" className="order-progress">
      <div className="glass-order-heading"><strong>Order progress</strong><Status>{result.status}</Status></div>
      <dl className="glass-progress-metrics">
        <div><dt>Requested</dt><dd>{history.requested.toLocaleString()}</dd></div>
        <div><dt>Submitted</dt><dd>{last.submitted.toLocaleString()}</dd></div>
        <div><dt>Verified fulfilled</dt><dd>{last.completed.toLocaleString()}</dd></div>
        <div><dt>Remaining</dt><dd>{Math.max(0, history.requested - last.completed).toLocaleString()}</dd></div>
      </dl>
      <svg
        viewBox={"0 0 " + W + " " + H}
        role="img"
        aria-label={
          "Quantity by actual event time. Submitted " +
          last.submitted +
          ", accepted " +
          last.accepted +
          ", completed " +
          last.completed
        }
        style={{
          width: "100%",
          display: "block",
          maxHeight: expanded ? 280 : 164,
        }}
      >
        <path
          d={`M${pad} ${top}V${bottom}H${right}`}
          stroke="currentColor"
          fill="none"
          opacity=".4"
        />
        <path
          d={`M${pad} ${top}H${right}`}
          stroke="currentColor"
          strokeDasharray="2 5"
          opacity=".3"
        />
        <g fill="currentColor" fontSize="10">
          <text x={pad - 5} y={top + 4} textAnchor="end">
            {history.requested}
          </text>
          <text x={pad - 5} y={bottom} textAnchor="end">
            0
          </text>
          <text x={pad} y={H - 6}>
            {stamp(t0)}
          </text>
          {span > 0 && (
            <text x={right} y={H - 6} textAnchor="end">
              {stamp(last.time)}
            </text>
          )}
        </g>
        {(["submitted", "accepted", "completed"] as const).map((key, i) => (
          <g key={key} fill={["#a376ff", "#5bc2ff", "#36c99e"][i]}>
            <path
              d={path(key)}
              fill="none"
              stroke={["#a376ff", "#5bc2ff", "#36c99e"][i]}
              strokeWidth={[5, 3, 2][i]}
              strokeDasharray={i === 1 ? "6 4" : undefined}
            />
            <circle cx={x(last)} cy={y(last[key])} r={4 - i * 0.65} />
          </g>
        ))}
      </svg>
      <p>
        <span style={{ color: "#a376ff" }}>●</span> Submitted {last.submitted} ·{" "}
        <span style={{ color: "#5bc2ff" }}>●</span> Accepted {last.accepted} ·{" "}
        <span style={{ color: "#36c99e" }}>●</span> Completed {last.completed}
      </p>
      <p>
        Last recorded update{" "}
        <time dateTime={new Date(last.time).toISOString()}>
          {stamp(last.time)}
        </time>
      </p>
      {expanded && (
        <>
          <p>
            Batch acceptance {pct(result.acceptanceRate)} · Confirmed completion{" "}
            {pct(result.completionRate)} · Quantity fulfilled{" "}
            {pct(result.fulfilledPercent)}
          </p>
          <p>
            Pending {counts.pending} · Submitting {counts.submitting} ·
            Successful submissions {result.accepted} · Provider accepted{" "}
            {result.accepted} · Completed {counts.completed} · Partial{" "}
            {counts.partial} · Failed {counts.failed} · Cancelled{" "}
            {counts.cancelled} · Uncertain {counts.uncertain}
          </p>
          <small>
            Acceptance uses submissions with a known outcome. Confirmed
            completion uses accepted batches with a final outcome. A provider
            order ID verifies submission and acceptance together. Verified
            processing and partial quantities use the provider’s reported
            remainder.
          </small>
          {history.events.some((e) => e.legacy) && (
            <p>
              Earlier history uses the timestamps and results retained on the
              original orders.
            </p>
          )}
          <details className="glass-timeline">
            <summary>Recorded event history ({history.events.length})</summary>
            {history.events.length ? <ol>{history.events.map((event, index) => (
              <li key={event.batch + event.time + index}>
                <Status>{event.status || event.stage}</Status>
                <time dateTime={event.time}>{stamp(Date.parse(event.time))}</time>
                <small>{event.submitted} submitted · {event.accepted} accepted · {event.completed} verified fulfilled</small>
              </li>
            ))}</ol> : <p>No events recorded yet.</p>}
          </details>
        </>
      )}
    </section>
  );
}
export async function readProgress(
  ids: string[],
): Promise<Record<string, History>> {
  if (!ids.length) return {};
  const r = await db!.rpc("voxx_progress", { groups: ids });
  if (r.error) throw Error("Order progress unavailable");
  return r.data ?? {};
}
export function ConfirmedProgress({
  id,
  requested,
}: {
  id: string;
  requested: number;
}) {
  const [history, setHistory] = useState<History>(() => ({
      requested,
      created: new Date().toISOString(),
      events: [],
      batches: 1,
      campaignState: null,
    })),
    [error, tell] = useState("");
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const result = await readProgress([id]);
        if (active && result[id]) {
          setHistory(result[id]);
          tell("");
        }
      } catch {
        if (active) tell("Waiting for a database update.");
      } finally {
        if (active) timer = setTimeout(tick, 10000);
      }
    }
    void tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);
  return (
    <>
      <ProgressGraph history={history} />
      {error && <small>{error}</small>}
      <p>
        <a href={"?order=" + id}>Full order details</a>
      </p>
    </>
  );
}
