import { createClient } from "@supabase/supabase-js";
import { randomBytes, createHash } from "node:crypto";
import { database } from "../server/operations.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export default {
  async fetch(request: Request) {
    const reply = (status: number, body: object) =>
      Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return reply(401, { error: "Authentication required" });
    const db = database();
    try {
      if (
        request.method === "POST" &&
        new URL(request.url).searchParams.has("issue")
      ) {
        const user = await db.auth.getUser(token);
        if (!user.data.user) return reply(401, { error: "Invalid session" });
        const client = createClient(
          process.env.SUPABASE_URL!,
          process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
          { global: { headers: { Authorization: "Bearer " + token } } },
        );
        if ((await client.rpc("voxx_role")).data !== "reseller")
          return reply(403, { error: "Verified reseller session required" });
        const key = "vx_" + randomBytes(32).toString("hex");
        const r = await db.rpc("voxx_issue_key", {
          owner: user.data.user.id,
          fingerprint: hash(key),
        });
        return r.error
          ? reply(403, { error: "Reseller access required" })
          : reply(201, { key, id: r.data });
      }
      const auth = await db.rpc("voxx_key_owner", { fingerprint: hash(token) });
      if (!auth.data || auth.error)
        return reply(403, { error: "Invalid key or rate limit reached" });
      if (
        request.method === "GET" &&
        new URL(request.url).searchParams.has("services")
      ) {
        const r = await db.rpc("voxx_reseller_catalogue", { owner: auth.data });
        if (r.error) throw Error();
        return reply(200, { services: r.data });
      }
      if (request.method === "GET") {
        const r = await db
          .from("voxx_orders")
          .select(
            "id,service_id,quantity,total_inr,state,provider_status,created_at",
          )
          .eq("owner_id", auth.data)
          .order("created_at", { ascending: false })
          .limit(100);
        if (r.error) throw Error();
        return reply(200, { orders: r.data });
      }
      if (request.method === "POST") {
        const b = await request.json();
        const r = await db.rpc("voxx_reseller_order", {
          owner: auth.data,
          service_number: b.service,
          target_url: b.link,
          units: b.quantity,
          token: b.request_id,
          expected_total: b.total_inr,
        });
        return r.error
          ? reply(422, {
              error: "Order rejected. Verify price, quantity and request ID.",
            })
          : reply(201, { id: r.data });
      }
      return reply(405, { error: "Unsupported method" });
    } catch {
      return reply(503, { error: "Reseller service unavailable" });
    }
  },
};
