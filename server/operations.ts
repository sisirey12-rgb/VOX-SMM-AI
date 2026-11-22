import { createClient } from "@supabase/supabase-js";
import { Provider, SubmissionRejected } from "./provider.ts";
export function database() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
function provider() {
  if (process.env.SMMXPERT_LIVE_ENABLED !== "true")
    throw Error("Provider disabled");
  return new Provider(process.env.SMMXPERT_API_KEY!);
}
export async function syncCatalogue() {
  let stage = "supabase configuration";
  let code: string | undefined;
  let reason: string | undefined;
  try {
    const db = database();
    stage = "start";
    const generation = await db.rpc("voxx_sync_start");
    if (generation.error) {
      code = generation.error.code;
      throw Error("Could not initialize sync");
    }

    stage = "provider configuration";
    const api = provider();
    stage = "provider catalogue";
    const { rows, currency } = await api.catalogue();

    stage = "commit";
    const { data: committed, error } = await db.rpc("voxx_sync_commit", {
      rows,
      currency_code: currency,
      generation: generation.data,
    });
    if (error) {
      code = error.code;
      throw Error("Catalogue transaction failed");
    }
    if (!committed) {
      reason = "Snapshot superseded";
      throw Error(reason);
    }
    return { count: rows.length };
  } catch (error) {
    if (error instanceof Error && safeSyncReasons.has(error.message))
      reason = error.message;
    console.error("Catalogue sync failed", {
      stage,
      code: code && /^[A-Z0-9]{5,8}$/.test(code) ? code : undefined,
      reason,
    });
    throw error;
  }
}

const safeSyncReasons = new Set([
  "Provider disabled",
  "Missing provider key",
  "Unexpected provider URL",
  "Provider unavailable",
  "Provider rejected request",
  "Missing provider currency",
  "Empty catalogue",
  "Invalid catalogue entry",
]);

export async function dispatch(id: string) {
  if (process.env.VOXX_ORDER_DISPATCH !== "true")
    throw Error("Dispatch disabled");
  const api = provider(),
    db = database();
  const { data, error } = await db.rpc("voxx_claim_order", { order_id: id });
  if (error || !data?.length) throw Error("Order unavailable");
  const order = data[0];
  try {
    const provider_id = await api.submit(
      order.service_id,
      order.target,
      order.quantity,
    );
    const saved = await db
      .from("voxx_orders")
      .update({
        provider_id,
        dispatched_at: new Date().toISOString(),
        state: "Submitted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("state", "Submitting")
      .select("id")
      .single();
    if (saved.error) throw Error("Reconciliation required");
  } catch (error) {
    await db
      .from("voxx_orders")
      .update({
        state: "Needs reconciliation",
        submission_rejected: error instanceof SubmissionRejected,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("state", "Submitting");
    throw Error("Review upstream order history before taking further action");
  }
  return { submitted: true };
}
export async function poll() {
  const db = database(),
    api = provider();
  const stalled = await db
    .from("voxx_orders")
    .update({
      state: "Needs reconciliation",
      updated_at: new Date().toISOString(),
    })
    .eq("state", "Submitting")
    .lt("updated_at", new Date(Date.now() - 15 * 60000).toISOString());
  if (stalled.error) throw Error("Unable to identify stalled submissions");
  const { data, error } = await db
    .from("voxx_orders")
    .select("id,provider_id,updated_at")
    .eq("state", "Submitted")
    .order("updated_at")
    .limit(100);
  if (error) throw Error("Order query failed");
  if (!data.length) return { checked: 0 };
  const statuses = await api.statuses(data.map((o) => o.provider_id));
  for (const order of data) {
    const entry = statuses[order.provider_id],
      now = new Date().toISOString();
    const fields: Record<string, string | number | null> = { updated_at: now };
    if (typeof entry?.status === "string" && entry.status.length <= 80) {
      fields.provider_status = entry.status;
      if (
        /^\d+(\.\d+)?$/.test(String(entry.charge)) &&
        /^[A-Z]{3}$/.test(entry.currency)
      ) {
        fields.provider_charge = String(entry.charge);
        fields.provider_currency = entry.currency;
      }
      if (
        /^\d+$/.test(String(entry.start_count)) &&
        Number.isSafeInteger(Number(entry.start_count))
      )
        fields.start_count = Number(entry.start_count);
      if (entry.status.toLowerCase() === "partial") fields.remaining = null;
      if (
        /^\d+$/.test(String(entry.remains)) &&
        Number.isSafeInteger(Number(entry.remains))
      )
        fields.remaining = Number(entry.remains);
      if (
        ["completed", "partial", "canceled", "cancelled", "failed"].includes(
          entry.status.toLowerCase(),
        )
      )
        fields.state = "Closed";
    }
    const saved = await db
      .from("voxx_orders")
      .update(fields)
      .eq("id", order.id)
      .eq("state", "Submitted")
      .eq("provider_id", order.provider_id)
      .eq("updated_at", order.updated_at);
    if (saved.error) throw Error("Status persistence failed");
  }
  return { checked: data.length };
}

export async function dueCampaigns() {
  if (process.env.VOXX_ORDER_DISPATCH !== "true") return { attempted: 0 };
  const db = database(),
    r = await db.rpc("voxx_due");
  if (r.error) throw Error("Scheduled order query failed");
  let failures = 0;
  for (const row of r.data ?? []) {
    try {
      await dispatch(row.id);
    } catch {
      failures++;
    }
  }
  if (failures) throw Error("Scheduled orders require review");
  return { attempted: r.data?.length ?? 0 };
}
