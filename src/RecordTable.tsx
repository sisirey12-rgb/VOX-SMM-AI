import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { money } from "./catalogue";
import { GlassDialog, Status } from "./UltraGlass";

type RecordRow = Record<string, string | number | null>;

function displayValue(key: string, value: RecordRow[string]) {
  if (value == null) return "—";
  return key === "paise" ? money(Number(value) / 100) : String(value);
}

export function RecordTable({ rows, title }: { rows: RecordRow[]; title: string }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(null);
  const visible = rows.filter((row) =>
    Object.entries(row).some(([key, value]) => displayValue(key, value).toLowerCase().includes(query.trim().toLowerCase())),
  );
  if (sort) {
    visible.sort((a, b) => {
      const left = a[sort.key], right = b[sort.key];
      const order = typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true });
      return sort.descending ? -order : order;
    });
  }
  const keys = Object.keys(rows[0]);
  return (
    <div className="glass-records">
      <div className="glass-record-toolbar">
        <label>Filter loaded records<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <span role="status">{visible.length} of {rows.length} records</span>
      </div>
      {visible.length ? (
        <div className="table-wrap" role="region" aria-label={title + " table"} tabIndex={0}>
          <table>
            <thead>
              <tr>
                {keys.map((key) => {
                  const current = sort?.key === key;
                  const Icon = current ? (sort.descending ? ArrowDown : ArrowUp) : ArrowUpDown;
                  return (
                    <th key={key} scope="col" aria-sort={current ? (sort.descending ? "descending" : "ascending") : undefined}>
                      <button type="button" onClick={() => setSort({ key, descending: current && !sort.descending })}>{key.replace(/_/g, " ")} <Icon size={13} aria-hidden="true" /></button>
                    </th>
                  );
                })}
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row, index) => (
                <tr key={String(row.id ?? rows.indexOf(row))}>
                  {keys.map((key) => (
                    <td key={key}>{key === "state" && row[key] ? <Status>{String(row[key])}</Status> : displayValue(key, row[key])}</td>
                  ))}
                  <td>
                    <GlassDialog title={title + " record"} triggerLabel={"View record " + (index + 1)} trigger="View">
                      {() => <dl className="glass-record-detail">{keys.map((key) => <div key={key}><dt>{key.replace(/_/g, " ")}</dt><dd>{displayValue(key, row[key])}</dd></div>)}</dl>}
                    </GlassDialog>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p>No records match this filter.</p>}
    </div>
  );
}
