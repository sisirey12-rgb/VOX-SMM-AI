import { reconcilePayment } from "../server/reconcile.ts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { database } from "../server/operations.ts";
export function signatureOK(raw: string, signature: string, secret: string) {
  if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(
    createHmac("sha256", secret).update(raw).digest(),
    Buffer.from(signature, "hex"),
  );
}
export default {
  async fetch(req: Request) {
    const reply = (status: number, body: object) =>
      Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    const mode =
      process.env.RAZORPAY_KEY_ID?.startsWith("rzp_live_") &&
      process.env.RAZORPAY_LIVE_APPROVED === "true"
        ? "live"
        : "test";
    if (req.method === "GET") return reply(200, { mode });
    if (req.method !== "POST") return reply(405, { error: "POST required" });
    if (!process.env.RAZORPAY_KEY_ID?.startsWith("rzp_" + mode + "_"))
      return reply(503, { error: "Test payments unavailable" });
    try {
      const raw = await req.text();
      if (raw.length > 131072)
        return reply(413, { error: "Request too large" });
      const db = database();
      if (new URL(req.url).searchParams.get("webhook") === "1") {
        if (
          !signatureOK(
            raw,
            req.headers.get("x-razorpay-signature") ?? "",
            process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
          )
        )
          return reply(401, { error: "Invalid signature" });
        const event = JSON.parse(raw);
        if (event.event === "refund.processed") {
          const ref = event.payload.refund.entity;
          if (ref.status !== "processed" || !Number.isSafeInteger(ref.amount))
            return reply(422, { error: "Invalid refund" });
          const r = await db.rpc("voxx_refund", {
            refund_id: ref.id,
            payment_id: ref.payment_id,
            amount_paise: ref.amount,
          });
          return r.error
            ? reply(503, { error: "Refund awaiting capture" })
            : reply(200, { ok: true });
        }
        if (event.event === "payment.failed") {
          const p = event.payload.payment.entity;
          const r = await db
            .from("voxx_payments")
            .update({ state: "Failed" })
            .eq("id", p.order_id)
            .eq("state", "Pending");
          return r.error
            ? reply(503, { error: "Update unavailable" })
            : reply(200, { ok: true });
        }
        if (event.event !== "payment.captured")
          return reply(200, { ignored: true });
        const p = event.payload.payment.entity,
          eventId = req.headers.get("x-razorpay-event-id");
        if (
          !eventId ||
          p.currency !== "INR" ||
          p.status !== "captured" ||
          !Number.isSafeInteger(p.amount)
        )
          return reply(422, { error: "Invalid capture" });
        const { error } = await db.rpc("voxx_capture", {
          event_key: eventId,
          gateway_order: p.order_id,
          gateway_payment: p.id,
          amount_paise: p.amount,
        });
        return error
          ? reply(503, { error: "Capture awaiting reconciliation" })
          : reply(200, { ok: true });
      }
      const token = req.headers
        .get("authorization")
        ?.match(/^Bearer (\S+)$/i)?.[1];
      if (!token) return reply(401, { error: "Sign in required" });
      const { data, error } = await db.auth.getUser(token);
      if (error || !data.user) return reply(401, { error: "Invalid session" });
      const quota = await db.rpc("voxx_quota", {
        subject_key: "payment/" + data.user.id,
        max_calls: 10,
      });
      if (quota.data !== true) return reply(429, { error: "Please try later" });
      const { amount, reconcile } = JSON.parse(raw);
      if (
        typeof reconcile === "string" &&
        /^order_[A-Za-z0-9]+$/.test(reconcile)
      )
        return reply(
          200,
          await reconcilePayment(
            reconcile,
            data.user.id,
            Buffer.from(
              process.env.RAZORPAY_KEY_ID +
                ":" +
                process.env.RAZORPAY_KEY_SECRET,
            ).toString("base64"),
          ),
        );
      if (!Number.isSafeInteger(amount) || amount < 100 || amount > 10000000)
        return reply(400, { error: "Amount outside permitted range" });
      const response = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(12000),
        headers: {
          "Content-Type": "application/json",
          Authorization:
            "Basic " +
            Buffer.from(
              process.env.RAZORPAY_KEY_ID +
                ":" +
                process.env.RAZORPAY_KEY_SECRET,
            ).toString("base64"),
        },
        body: JSON.stringify({
          amount,
          currency: "INR",
          receipt: crypto.randomUUID(),
        }),
      });
      if (!response.ok) return reply(502, { error: "Gateway unavailable" });
      const order = await response.json();
      if (!order.id || order.amount !== amount || order.currency !== "INR")
        throw Error();
      const saved = await db
        .from("voxx_payments")
        .insert({ id: order.id, owner_id: data.user.id, paise: amount, mode });
      if (saved.error) throw Error();
      return reply(200, {
        mode,
        key: process.env.RAZORPAY_KEY_ID,
        order_id: order.id,
        amount,
        currency: "INR",
      });
    } catch {
      return reply(503, { error: "Payment operation unavailable" });
    }
  },
};
