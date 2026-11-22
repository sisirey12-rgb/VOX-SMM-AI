import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
test("paced quotes, bookings, funding and dispatch spacing", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
 create table auth.users(id uuid primary key);create table auth.mfa_factors(user_id uuid,status text);
 create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select current_setting('test.uid',true)::uuid$$;
 grant usage on schema auth to authenticated,anon,service_role;`);
    for (const f of (await readdir("supabase/migrations")).sort())
      await pg.exec(await readFile("supabase/migrations/" + f, "utf8"));
    const user = crypto.randomUUID(),
      admin = crypto.randomUUID(),
      seed = "abcdeabc-0000-4000-a000-000000000001";
    const as = async (id) => {
      await pg.exec("reset role;set role authenticated");
      await pg.query("select set_config('test.uid',$1,false)", [id]);
    };
    await pg.query("insert into auth.users values($1),($2)", [user, admin]);
    await pg.query("update voxx_profiles set role='admin' where id=$1", [
      admin,
    ]);
    await pg.query("select voxx_publish($1)", [
      JSON.stringify([
        {
          service: 5,
          type: "Default",
          category: "Marketing",
          name: "Test service",
          rate: "80",
          min: 5,
          max: 200,
          refill: false,
          cancel: false,
        },
      ]),
    ]);
    await as(admin);
    await pg.exec(
      "select voxx_price('live',5,null,true);insert into voxx_schedule_rules values(5,3,120,150,2,'Verified fixture for independent orders',now());update voxx_pacing set slow_hourly=100,medium_hourly=200,target_gap=30,batch_min=5,batch_max=200,qty_variation=35,time_variation=45,max_duration=20000,hourly_fee=3 where service_id=5",
    );
    await as(user);
    const quote = async (qty, mode = "slow", minutes = null, key = seed) =>
      (
        await pg.query("select voxx_paced_quote(5,$1,$2,$3,$4) q", [
          qty,
          mode,
          minutes,
          key,
        ])
      ).rows[0].q;
    const q = await quote(1000);
    assert.equal(q.duration, 600);
    assert.equal(q.fee, 32);
    assert.equal(q.total, 132);
    assert.deepEqual(q, await quote(1000));
    assert.equal((await quote(2000)).duration, 1200);
    assert.equal((await quote(1000, "medium")).duration, 300);
    assert.equal((await quote(1000, "custom", 481)).duration, 481);
    await assert.rejects(quote(1000, "custom", 100));
    const gaps = q.batches
      .slice(1)
      .map((b, i) => b.offset - q.batches[i].offset);
    assert.ok(new Set(gaps).size > 1);
    assert.ok(new Set(q.batches.map((x) => x.quantity)).size > 1);
    assert.ok(gaps.every((g) => g >= 3 && g <= 120));
    assert.equal(q.batches.at(-1).offset, 600);
    assert.equal(
      q.batches.reduce((s, b) => s + b.quantity, 0),
      1000,
    );
    await assert.rejects(
      pg
        .exec("update voxx_pacing set medium_hourly=99999 returning 1")
        .then((r) => {
          if (!r[0].affectedRows) throw Error("denied");
        }),
    );
    await assert.rejects(
      pg.query(
        "select voxx_schedule(5,'https://example.com',20,$1,2,now()+interval '1 hour',3,3,2)",
        [crypto.randomUUID()],
      ),
    );
    const start = new Date(Date.now() + 3600000).toISOString(),
      book = (accepted) =>
        pg.query(
          "select voxx_book_paced(5,1000,'slow',null,$1,'https://example.com', $2,$3)",
          [seed, start, JSON.stringify(accepted)],
        );
    await assert.rejects(book({ ...q, total: 0 }));
    await assert.rejects(book(q), /Insufficient available live wallet balance/);
    await pg.exec("reset role");
    await pg.query(
      "insert into voxx_ledger(owner_id,reference,mode,paise) values($1,'test-funded','live',1000000)",
      [user],
    );
    await as(user);
    await book(q);
    await book(q);
    const orders = (
      await pg.query(
        "select id,quantity,total_inr,gap_minutes from voxx_orders where campaign_id=$1 order by due_at",
        [seed],
      )
    ).rows;
    assert.deepEqual(
      orders.map((b) => Number(b.quantity)),
      q.batches.map((b) => b.quantity),
    );
    assert.deepEqual(
      orders.map((b) => b.gap_minutes),
      [0, ...gaps],
    );
    await pg.exec("reset role");
    await pg.query(
      "update voxx_orders set due_at=due_at-interval '2 days' where campaign_id=$1",
      [seed],
    );
    assert.equal(
      (await pg.query("select * from voxx_due()")).rows[0].id,
      orders[0].id,
    );
    await pg.query("select * from voxx_claim_order($1)", [orders[0].id]);
    await pg.query(
      "update voxx_orders set provider_id='500',state='Submitted',dispatched_at=now() where id=$1",
      [orders[0].id],
    );
    assert.equal((await pg.query("select * from voxx_due()")).rows.length, 0);
    await pg.query(
      "update voxx_orders set dispatched_at=now()-interval '2 days' where id=$1",
      [orders[0].id],
    );
    assert.equal(
      (await pg.query("select * from voxx_due()")).rows[0].id,
      orders[1].id,
    );
    await as(admin);
    await pg.exec("update voxx_pacing set enabled=false where service_id=5");
    await pg.exec("reset role");
    assert.equal((await pg.query("select * from voxx_due()")).rows.length, 0);
    assert.equal(
      (await pg.query("select * from voxx_claim_order($1)", [orders[1].id]))
        .rows.length,
      0,
    );
    await as(admin);
    await pg.exec("update voxx_pacing set enabled=true");
    await as(user);
    const large = await quote(6000, "slow", null, crypto.randomUUID());
    assert.ok(large.batches.length > 30);
    const other = crypto.randomUUID();
    const layout = await quote(6000, "slow", null, other);
    await pg.query(
      "select voxx_book_paced(5,6000,'slow',null,$1,'https://example.org',$2,$3)",
      [other, start, JSON.stringify(layout)],
    );
    assert.equal(
      (
        await pg.query(
          "select count(*) n from voxx_orders where campaign_id=$1",
          [other],
        )
      ).rows[0].n,
      layout.batches.length,
    );

    await as(admin);
    await pg.exec(
      "update voxx_pacing set provider_capacity=50 where service_id=5",
    );
    await as(user);
    assert.equal((await quote(1000, "medium")).duration, 1200);
    await as(admin);
    await pg.exec(
      "update voxx_pacing set provider_capacity=null where service_id=5",
    );
    await pg.exec("reset role");
    for (let i = 0; i < 3; i++)
      await pg.query(
        "insert into voxx_orders(owner_id,request_key,service_id,service_name,target,quantity,unit_rate,total_inr,provider_id,dispatched_at,created_at,state,provider_status) values($1,gen_random_uuid(),5,'Consultation','https://example.org',100,100,10,$2,now()-interval '2 hours',now()-interval '3 hours','Submitted',null)",
        [user, String(6000 + i)],
      );
    await pg.exec(
      "update voxx_orders set state='Closed', provider_status='Completed' where provider_id in ('6000','6001','6002')",
    );
    await as(user);
    const measured = await quote(1000, "medium");
    assert.equal(measured.samples, 3);
    assert.ok(measured.duration >= 1200);
    const manual = await pg.query(
      "select voxx_schedule(5,'https://example.org',20,$1,2,now()+interval '1 hour',30,3,2) id",
      [crypto.randomUUID()],
    );
    const fixed = await pg.query(
      "select quantity,due_at from voxx_orders where campaign_id=$1 order by due_at",
      [manual.rows[0].id],
    );
    assert.deepEqual(
      fixed.rows.map((r) => Number(r.quantity)),
      [20, 20, 20],
    );
    assert.equal(
      +new Date(fixed.rows[1].due_at) - new Date(fixed.rows[0].due_at),
      30 * 60000,
    );
    // A bundle uses distinct services, one funded booking, and a shared start.
    await pg.exec("reset role");
    const buyer = crypto.randomUUID();
    await pg.query("insert into auth.users values($1)", [buyer]);
    await pg.exec(`
      insert into voxx_private.services(source,id,name,category,kind,cost,minimum,maximum,refill,cancel,visible)
        values('live',6,'Second action','Video action','Default',80,5,200,false,false,true);
      insert into voxx_schedule_rules
        values(6,3,120,150,2,'Verified fixture for independent orders',now());
      insert into voxx_bundle_categories values('Marketing','youtube'),('Video action','twitch');
    `);
    await as(admin);
    const bundle = crypto.randomUUID();
    const components = JSON.stringify([
      { service_id: 5, quantity: 100 },
      { service_id: 6, quantity: 120 },
    ]);
    const saveBundle = () => pg.query(
      "insert into voxx_bundles(id,name,platform,components) values($1,'Video bundle','youtube',$2)",
      [bundle, components],
    );
    await assert.rejects(saveBundle(), /same platform/);
    await pg.exec("update voxx_bundle_categories set platform='youtube' where category='Video action'");
    await saveBundle();
    await as(buyer);
    const bundleSeed = crypto.randomUUID();
    const { rows: [{ q: bundleQuote }] } = await pg.query(
      "select voxx_bundle_quote($1,'slow',null,$2) q", [bundle, bundleSeed],
    );
    assert.equal(bundleQuote.parts.length, 2);
    assert.equal(bundleQuote.total, bundleQuote.parts.reduce((total, part) => total + part.plan.total, 0));
    assert.ok(bundleQuote.parts.every((part) => part.plan.batches[0].offset === 0));
    const bookBundle = () => pg.query(
      "select voxx_book_bundle($1,$2,'https://example.org/video',$3,$4) id",
      [bundle, bundleSeed, start, JSON.stringify(bundleQuote)],
    );
    await assert.rejects(bookBundle(), /Insufficient available live wallet balance/);
    assert.equal((await pg.query("select * from voxx_campaigns")).rows.length, 0);
    await pg.exec("reset role");
    await pg.query(
      "insert into voxx_ledger(owner_id,reference,mode,paise) values($1,'bundle-funded','live',$2)",
      [buyer, Math.round(bundleQuote.total * 100)],
    );
    await as(buyer);
    assert.equal((await bookBundle()).rows[0].id, bundleSeed);
    assert.equal((await bookBundle()).rows[0].id, bundleSeed);
    const children = (await pg.query(
      "select start_at, state from voxx_campaigns where bundle_booking_id=$1", [bundleSeed],
    )).rows;
    assert.equal(children.length, 2);
    const history = (await pg.query("select * from voxx_my_bundles()")).rows;
    assert.equal(history[0].id, bundleSeed);
    assert.equal(history[0].components.length, 2);
    await as(user);
    assert.equal((await pg.query("select * from voxx_my_bundles()")).rows.length, 0);
    assert.ok(children.every((row) => +new Date(row.start_at) === +new Date(start) && row.state === "Active"));
    await pg.exec("reset role");
    await pg.query(
      "update voxx_orders set due_at=due_at-interval '2 days' where campaign_id in (select id from voxx_campaigns where bundle_booking_id=$1)",
      [bundleSeed],
    );
    assert.equal((await pg.query("select * from voxx_due_batches() where bundle_id=$1", [bundleSeed])).rows.length, 2);
    await pg.exec("update voxx_private.services set visible=false where source='live' and id=6");
    await as(buyer);
    await assert.rejects(
      pg.query("select voxx_bundle_quote($1,'slow',null,$2)", [bundle, crypto.randomUUID()]),
      /no longer available/,
    );
  } finally {
    await pg.close();
  }
});
