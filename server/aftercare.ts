import { database } from "./operations.ts";
import { Provider } from "./provider.ts";
export async function aftercare(id: string, action: "cancel" | "refill") {
  if (
    process.env.SMMXPERT_LIVE_ENABLED !== "true" ||
    process.env.VOXX_ORDER_DISPATCH !== "true"
  )
    throw Error("Provider unavailable");
  const db = database(),
    provider = new Provider(process.env.SMMXPERT_API_KEY!);
  const claimed = await db.rpc("voxx_claim_aftercare", {
    order_id: id,
    kind: action,
  });
  if (claimed.error || !claimed.data) throw Error("Ineligible order");
  const update: Record<string, string> = {};
  try {
    if (action === "cancel") {
      const result = await provider.cancel([claimed.data]);
      const entry = Array.isArray(result)
        ? result.find((r) => String(r.order) === claimed.data)
        : null;
      if (entry?.cancel !== 1) throw Error();
      update.aftercare = "Cancellation submitted";
    } else {
      const result = await provider.refill(claimed.data);
      if (!/^[1-9]\d*$/.test(String(result.refill))) throw Error();
      update.refill_id = String(result.refill);
      update.aftercare = "Refill pending";
    }
  } catch {
    update.aftercare = "Check " + action + " with provider";
  }
  const r = await db
    .from("voxx_orders")
    .update(update)
    .eq("id", id)
    .select("id")
    .single();
  if (r.error) throw Error("Update failed");
  return { status: update.aftercare };
}
export async function pollRefills() {
  if (process.env.SMMXPERT_LIVE_ENABLED !== "true") return;
  const db = database(),
    provider = new Provider(process.env.SMMXPERT_API_KEY!);
  const r = await db
    .from("voxx_orders")
    .select("id,refill_id")
    .eq("aftercare", "Refill pending")
    .order("updated_at")
    .limit(100);
  if (r.error) throw Error();
  if (!r.data.length) return;
  const result = await provider.refillStatuses(r.data.map((x) => x.refill_id));
  if (!Array.isArray(result)) throw Error("Invalid refill status reply");
  for (const o of r.data) {
    const status = result.find((x) => String(x.refill) === o.refill_id)?.status;
    const up = await db
      .from("voxx_orders")
      .update({
        aftercare: ["Completed", "Rejected"].includes(status)
          ? "Refill " + status
          : "Refill pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", o.id)
      .eq("aftercare", "Refill pending");
    if (up.error) throw Error();
  }
}
