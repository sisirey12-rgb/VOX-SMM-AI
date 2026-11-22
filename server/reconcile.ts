import { database } from "./operations.ts";
export async function reconcilePayment(
  orderId: string,
  user: string,
  token: string,
) {
  const db = database(),
    p = await db
      .from("voxx_payments")
      .select("owner_id,mode,id,paise")
      .eq("id", orderId)
      .maybeSingle();
  if (p.error || !p.data || p.data.owner_id !== user)
    throw Error("Payment unavailable");
  if (!process.env.RAZORPAY_KEY_ID?.startsWith("rzp_" + p.data.mode + "_"))
    throw Error("Wrong gateway mode");
  const res = await fetch(
    "https://api.razorpay.com/v1/orders/" +
      encodeURIComponent(orderId) +
      "/payments",
    {
      headers: { Authorization: "Basic " + token },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!res.ok) throw Error("Gateway unavailable");
  const items = (await res.json()).items;
  if (!Array.isArray(items)) throw Error("Unexpected gateway data");
  const capture = items.find(
    (p) =>
      p.status === "captured" &&
      p.order_id === orderId &&
      p.currency === "INR" &&
      p.captured === true,
  );
  if (!capture) return { status: "Awaiting capture" };
  if (capture.amount !== p.data.paise)
    throw Error("Unexpected captured amount");
  const r = await db.rpc("voxx_capture", {
    event_key: "reconcile/" + capture.id,
    gateway_order: orderId,
    gateway_payment: capture.id,
    amount_paise: capture.amount,
  });
  if (r.error) throw Error("Capture requires review");
  return { status: "Captured" };
}
