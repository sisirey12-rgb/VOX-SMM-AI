import { aftercare } from "../server/aftercare.ts";
import { database } from "../server/operations.ts";
import { createClient } from "@supabase/supabase-js";
import { dispatch, syncCatalogue, poll } from "../server/operations.ts";
export default {
  async fetch(request: Request) {
    const reply = (code: number, data: object) =>
      Response.json(data, {
        status: code,
        headers: { "Cache-Control": "no-store" },
      });
    if (request.method !== "POST")
      return reply(405, { error: "POST required" });
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) return reply(401, { error: "Sign in required" });
    try {
      const db = createClient(
        process.env.SUPABASE_URL!,
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
        {
          global: { headers: { Authorization: "Bearer " + token } },
          auth: { persistSession: false },
        },
      );
      const user = await db.auth.getUser(token);
      if (user.error || !user.data.user)
        return reply(401, { error: "Invalid session" });
      const role = await db.rpc("voxx_admin");
      if (role.data !== true || role.error)
        return reply(403, { error: "Administrator required" });
      const quota = await database().rpc("voxx_quota", {
        subject_key: "admin/" + user.data.user.id,
        max_calls: 30,
      });
      if (quota.data !== true) return reply(429, { error: "Please try later" });
      const body = await request.json();
      if (
        ["refill", "cancel"].includes(body.action) &&
        /^[a-f0-9-]{36}$/i.test(body.id)
      )
        return reply(200, await aftercare(body.id, body.action));
      if (body.action === "sync") return reply(200, await syncCatalogue());
      if (body.action === "poll") return reply(200, await poll());
      if (body.action === "dispatch" && /^[a-f0-9-]{36}$/i.test(body.id))
        return reply(200, await dispatch(body.id));
      return reply(400, { error: "Unknown operation" });
    } catch {
      return reply(409, {
        error:
          "Operation could not complete. Check configuration and refresh the order record.",
      });
    }
  },
};
