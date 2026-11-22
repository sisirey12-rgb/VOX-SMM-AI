import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
test("migrations, catalogue approval, order pricing, isolation and replayed payments", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(
      `create role anon; create role authenticated; create role service_role bypassrls; create schema auth;create function auth.jwt() returns jsonb language sql as $$select '{}'::jsonb$$;create table auth.mfa_factors(user_id uuid,status text);create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;grant usage on schema auth to authenticated,anon,service_role;`,
    );
    for (const f of (await readdir("supabase/migrations")).sort())
      await pg.exec(await readFile("supabase/migrations/" + f, "utf8"));
    const [a, b, admin, request] = Array.from({ length: 4 }, () =>
      crypto.randomUUID(),
    );
    await pg.query("insert into auth.users values($1),($2),($3)", [
      a,
      b,
      admin,
    ]);
    await pg.query(
      "update public.voxx_profiles set role='super_admin' where id=$1",
      [admin],
    );
    const incoming = [
      {
        service: 7,
        name: "Campaign consultation",
        category: "Marketing",
        type: "Default",
        min: 10,
        max: 1000,
        rate: "80",
        refill: false,
        cancel: false,
      },
    ];
    await pg.query("select voxx_publish($1)", [JSON.stringify(incoming)]);
    const asUser = async (id) => {
      await pg.exec("reset role;set role authenticated");
      await pg.query("select set_config('test.uid',$1,false)", [id]);
    };
    await asUser(a);
    assert.deepEqual(
      (await pg.query("select voxx_catalogue(false) as c")).rows[0].c.items,
      [],
    );
    await assert.rejects(pg.query("select voxx_price('live',7,null,true)"));
    await asUser(admin);
    await pg.query("select voxx_price('live',7,null,true)");
    await asUser(a);
    const order = (price) =>
      pg.query(
        "select voxx_request_order(7,'https://example.com/campaign',100,$1,$2) id",
        [request, price],
      );
    await assert.rejects(order(1));
    await assert.rejects(order(10), /Insufficient available live wallet balance/);
    await pg.exec("reset role");
    await pg.query(
      "insert into voxx_payments(id,owner_id,paise) values('order_test',$1,5000)",
      [a],
    );
    for (const id of ["evt1", "evt1", "evt2"])
      await pg.query("select voxx_capture($1,'order_test','pay_test',5000)", [
        id,
      ]);
    await asUser(a);
    assert.equal(
      Number((await pg.query("select voxx_test_balance() b")).rows[0].b),
      5000,
    );
    await asUser(b);
    assert.equal((await pg.query("select * from voxx_ledger")).rows.length, 0);
    await pg.exec("reset role");
    await asUser(a);
    await assert.rejects(order(10), /Insufficient available live wallet balance/);
    await pg.exec("reset role");
    await pg.query(
      "insert into voxx_payments(id,owner_id,paise,mode) values('live_test_fixture',$1,10000,'live')",
      [a],
    );
    await pg.query(
      "select voxx_capture('evt3','live_test_fixture','pay_fixture',10000)",
    );
    await asUser(a);
    const first = await order(10);
    assert.equal((await order(10)).rows[0].id, first.rows[0].id);
    await assert.rejects(
      pg.query(
        "select voxx_request_order(7,'https://example.com/second',1000,$1::uuid,100::numeric)",
        [crypto.randomUUID()],
      ),
      /Insufficient available live wallet balance/,
    );
    await asUser(b);
    assert.equal((await pg.query("select * from voxx_orders")).rows.length, 0);
    await assert.rejects(
      pg.query("select voxx_claim_order($1)", [first.rows[0].id]),
    );
    await pg.exec("reset role");
    assert.equal((await pg.query('select * from voxx_due()')).rows[0].id, first.rows[0].id);
    const claim = () =>
      pg.query("select * from voxx_claim_order($1)", [first.rows[0].id]);
    assert.equal((await claim()).rows.length, 1);
    assert.equal((await claim()).rows.length, 0);

    await pg.query(
      "insert into voxx_schedule_rules values(7,5,120,3,2,'Provider approval fixture only',now())",
    );
    await pg.query(
      "insert into voxx_ledger(owner_id,reference,mode,paise) values($1,'campaign-test-funds','live',2200)",
      [a],
    );
    await asUser(a);
    const campaign = crypto.randomUUID();
    const start = new Date(Date.now() + 600000).toISOString();
    const schedule = (runs) =>
      pg.query(
        "select voxx_schedule(7,'https://example.com/campaign',100,$1,10,$2,5,$3,2)",
        [campaign, start, runs],
      );
    await assert.rejects(schedule(4));
    await schedule(2);
    await schedule(2);
    assert.equal(
      (
        await pg.query("select id from voxx_orders where campaign_id=$1", [
          campaign,
        ])
      ).rows.length,
      2,
    );
    await assert.rejects(
      pg.query("select voxx_campaign_state($1,'approve')", [campaign]),
    );

    await pg.query("select voxx_campaign_state($1,'pause')", [campaign]);
    await pg.query("select voxx_campaign_state($1,'resume')", [campaign]);
    await pg.query("select voxx_campaign_state($1,'cancel')", [campaign]);
    await pg.exec("reset role");
    await pg.query("select voxx_refund('refund1','pay_test',1000)");
    await pg.query("select voxx_refund('refund1','pay_test',1000)");
    await asUser(a);
    assert.equal(
      Number((await pg.query("select voxx_test_balance() b")).rows[0].b),
      4000,
    );
    await asUser(admin);
    await pg.query("select voxx_manage_role($1,'reseller',null)", [b]);
    await pg.query(
      "insert into voxx_rules values('discount','reseller',10,now())",
    );
    await asUser(b);
    assert.equal(
      Number(
        (await pg.query("select voxx_catalogue(false) c")).rows[0].c.items[0]
          .price,
      ),
      90,
    );
    await pg.query(
      "insert into voxx_stores(id,name) values('test-shop','Test Shop')",
    );
    await asUser(a);
    await pg.query("select voxx_join_store('test-shop')");
    await assert.rejects(pg.query("select voxx_join_store('test-shop')"));
    await pg.exec("reset role");
    const key = (await pg.query("select voxx_issue_key($1,'fixture') k", [b]))
      .rows[0].k;
    assert.equal(
      (await pg.query("select voxx_key_owner('fixture') u")).rows[0].u,
      b,
    );
    await asUser(b);
    await pg.query("select voxx_revoke_key($1)", [key]);
    await pg.exec("reset role");
    assert.equal(
      (await pg.query("select voxx_key_owner('fixture') u")).rows[0].u,
      null,
    );

    await pg.exec("reset role");
    await pg.query(
      "update voxx_orders set provider_status='Partial',state='Closed' where id=$1",
      [first.rows[0].id],
    );
    await asUser(admin);
    await pg.query("select voxx_credit_order($1,100,'Verified partial')", [
      first.rows[0].id,
    ]);
    await assert.rejects(
      pg.query("select voxx_credit_order($1,100,'Repeated partial')", [
        first.rows[0].id,
      ]),
    );
    await pg.exec("reset role");
    const generation = (await pg.query("select voxx_sync_start() g")).rows[0].g;
    const imported = await pg.query("select voxx_sync_commit($1,'INR',$2) ok", [
      JSON.stringify(incoming),
      generation,
    ]);
    assert.equal(imported.rows[0].ok, true);
    assert.equal(
      (
        await pg.query("select voxx_sync_commit($1,'INR',$2) ok", [
          JSON.stringify(incoming),
          generation,
        ])
      ).rows[0].ok,
      false,
    );
    await pg.query("insert into auth.mfa_factors values($1,'verified')", [
      admin,
    ]);
    await asUser(admin);
    assert.equal((await pg.query("select voxx_admin() a")).rows[0].a, false);
  } finally {
    await pg.close();
  }
});
