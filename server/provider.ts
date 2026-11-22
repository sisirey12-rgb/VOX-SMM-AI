const endpoint = "https://smmxpert.com/api/v2";
export class SubmissionRejected extends Error {}
export class Provider {
  private key: string;
  private transport: typeof fetch;
  constructor(key: string, transport = fetch) {
    if (!key) throw Error("Missing provider key");
    if (
      process.env.SMMXPERT_API_URL &&
      process.env.SMMXPERT_API_URL !== endpoint
    )
      throw Error("Unexpected provider URL");
    this.key = key;
    this.transport = transport;
  }
  private async call(action: string, fields: Record<string, string> = {}) {
    const response = await this.transport(endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      body: new URLSearchParams({ ...fields, action, key: this.key }),
    });
    if (!response.ok) throw Error("Provider unavailable");
    const result = await response.json();
    if (
      action === "add" &&
      typeof result?.error === "string" &&
      result.error.trim() &&
      !result.order
    )
      throw new SubmissionRejected("Provider rejected submission");
    if (!result || typeof result !== "object" || "error" in result)
      throw Error("Provider rejected request");
    return result;
  }
  async catalogue() {
    const [account, rows] = await Promise.all([
      this.call("balance"),
      this.call("services"),
    ]);
    if (!/^[A-Z]{3}$/.test(account.currency))
      throw Error("Missing provider currency");
    return { rows: normalize(rows), currency: account.currency as string };
  }
  async submit(service: number, link: string, quantity: number) {
    if (![service, quantity].every(positive) || !validTarget(link))
      throw Error("Invalid order");
    const reply = await this.call("add", {
      service: String(service),
      link,
      quantity: String(quantity),
    });
    if (!positive(reply.order)) throw Error("Missing order ID");
    return String(reply.order);
  }
  statuses(ids: string[]) {
    return this.call("status", { orders: batch(ids) });
  }
  cancel(ids: string[]) {
    return this.call("cancel", { orders: batch(ids) });
  }
  refill(id: string) {
    return this.call("refill", { order: batch([id]) });
  }
  refillStatuses(ids: string[]) {
    return this.call("refill_status", { refills: batch(ids) });
  }
}
function positive(value: unknown) {
  return (
    (typeof value === "number" || typeof value === "string") &&
    /^[1-9]\d*$/.test(String(value)) &&
    Number.isSafeInteger(Number(value))
  );
}
function batch(ids: string[]) {
  if (!ids.length || ids.length > 100 || !ids.every(positive))
    throw Error("Invalid ID list");
  return ids.join(",");
}
export function validTarget(link: string) {
  try {
    const url = new URL(link);
    return (
      link.length <= 2048 &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
type Row = {
  service: number;
  name: string;
  category: string;
  type: string;
  rate: string;
  min: number;
  max: number;
  refill: boolean;
  cancel: boolean;
};
export function normalize(rows: unknown): Row[] {
  if (!Array.isArray(rows) || rows.length === 0) throw Error("Empty catalogue");
  const seen = new Set<number>();
  return rows.map((row) => {
    if (
      !row ||
      !positive(row.service) ||
      seen.has(+row.service) ||
      ![row.name, row.category, row.type].every(
        (s) => typeof s === "string" && s.trim(),
      ) ||
      !/^\d+(\.\d+)?$/.test(String(row.rate)) ||
      Number(row.rate) >= 1e12 ||
      ![row.min, row.max].every((v) => v === 0 || v === "0" || positive(v)) ||
      +row.max < +row.min ||
      typeof row.refill !== "boolean" ||
      typeof row.cancel !== "boolean"
    )
      throw Error("Invalid catalogue entry");
    seen.add(+row.service);
    return {
      service: +row.service,
      name: row.name.trim(),
      category: row.category.trim(),
      type: row.type.trim(),
      rate: String(row.rate),
      min: +row.min,
      max: +row.max,
      refill: row.refill,
      cancel: row.cancel,
    };
  });
}
