import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { summarize } from "../src/progress.ts";
test("durable step series, outcome metrics, unchanged polls, RLS and legacy snapshots", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key);create table auth.mfa_factors(user_id uuid,status text);
 create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select current_setting('test.uid',true)::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;`);
    const migrations = (await readdir("supabase/migrations")).sort();
    for (const f of migrations.slice(0, -1))
      await pg.exec(await readFile("supabase/migrations/" + f, "utf8"));
    const [user, admin, other, campaign, ...ids] = Array.from(
      { length: 10 },
      () => crypto.randomUUID(),
    );
    await pg.query("insert into auth.users values($1),($2),($3)", [
      user,
      admin,
      other,
    ]);
    await pg.query("update voxx_profiles set role='admin' where id=$1", [
      admin,
    ]);
    await pg.query(
      "insert into voxx_campaigns(id,owner_id,service_id,units,runs,start_at,minutes,fee_inr) values($1,$2,5,100,5,now(),20,0)",
      [campaign, user],
    );
    const add = (id) =>
      pg.query(
        "insert into voxx_orders(id,owner_id,request_key,service_id,service_name,target,quantity,unit_rate,total_inr,campaign_id) values($1,$2,$1,5,'Consultation','https://example.com',100,100,10,$3)",
        [id, user, campaign],
      );
    await add(ids[0]);
    await pg.query(
      "update voxx_orders set state='Closed',provider_id='9',provider_status='Completed',dispatched_at=now(),updated_at=now() where id=$1",
      [ids[0]],
    );
    await pg.exec(
      await readFile("supabase/migrations/" + migrations.at(-1), "utf8"),
    );
    for (const id of ids.slice(1)) await add(id);
    const read = async (id, as) => {
      await pg.exec("set role authenticated");
      await pg.query("select set_config('test.uid',$1,false)", [as]);
      try {
        return (await pg.query("select voxx_progress($1::uuid[]) data", [[id]]))
          .rows[0].data[id];
      } finally {
        await pg.exec("reset role");
      }
    };
    assert.equal(await read(campaign, other), undefined);
    const initial = await read(ids[1], user);
    assert.equal(summarize(initial).last.completed, 0);
    assert.equal(summarize(initial).acceptanceRate, null);
    const set = (id, sql) =>
      pg.query("update voxx_orders set " + sql + " where id=$1", [id]);
    await set(ids[1], "state='Submitted',provider_id='10',dispatched_at=now()");
    let h = await read(ids[1], user);
    assert.equal(summarize(h).last.accepted, 100);
    assert.equal(summarize(h).last.completed, 0);
    await set(ids[1], "provider_status='In progress',remaining=65");
    assert.equal(summarize(await read(ids[1], user)).last.completed, 35);
    await set(ids[1], "provider_status='Partial',remaining=40,state='Closed'");
    h = await read(ids[1], user);
    await set(ids[1], "updated_at=now(),remaining=40");
    assert.deepEqual(await read(ids[1], user), h);
    await set(ids[2], "state='Needs reconciliation',submission_rejected=true");
    await set(ids[3], "state='Needs reconciliation'");
    await set(ids[4], "state='Canceled'");
    const all = await read(campaign, user);
    assert.deepEqual(all, await read(campaign, admin));
    assert.ok(all.events.some((e) => e.legacy));
    const graph = summarize(all);
    assert.equal(graph.last.submitted, 200);
    assert.equal(graph.last.accepted, 200);
    assert.equal(graph.last.completed, 160);
    assert.equal(graph.counts.pending, 1);
    assert.equal(graph.counts.failed, 1);
    assert.equal(graph.counts.uncertain, 1);
    assert.equal(graph.counts.cancelled, 1);
    assert.equal(graph.counts.partial, 1);
    assert.equal(graph.acceptanceRate, 200 / 3);
    assert.equal(graph.completionRate, 50);
    assert.equal(graph.fulfilledPercent, 160 / 6);
    assert.deepEqual(summarize(await read(campaign, user)), graph);
  } finally {
    await pg.close();
  }
});

test("definite provider rejection and uncertain timeout stay distinguishable and neither is retried", async () => {
  const { Provider, SubmissionRejected } =
    await import("../server/provider.ts");
  for (const timeout of [false, true]) {
    let calls = 0;
    const p = new Provider("fixture", async () => {
      calls++;
      if (timeout) throw new DOMException("Timed out", "TimeoutError");
      return Response.json({ error: "Service unavailable" });
    });
    await assert.rejects(
      p.submit(9, "https://example.com/campaign", 100),
      (error) =>
        timeout
          ? error.name === "TimeoutError"
          : error instanceof SubmissionRejected,
    );
    assert.equal(calls, 1);
  }
});
