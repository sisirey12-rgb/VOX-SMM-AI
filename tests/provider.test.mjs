import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { Provider, normalize } from "../server/provider.ts";
import { signatureOK } from "../api/payment.ts";
import operations from "../api/operations.ts";
const row = {
  service: 4,
  type: "Default",
  name: " Marketing ",
  category: "Creative",
  rate: "1.052",
  min: "1",
  max: "1000",
  refill: false,
  cancel: true,
};
test("atomic snapshot validation preserves decimal rates", () => {
  assert.equal(normalize([row])[0].rate, "1.052");
  for (const bad of [
    [],
    [row, row],
    [{ ...row, cancel: "false" }],
    [{ ...row, min: 2000 }],
  ])
    assert.throws(() => normalize(bad));
});
test("default orders encode the provider contract and omit unverified scheduling", async () => {
  let calls = 0;
  const p = new Provider("test", async (url, init) => {
    calls++;
    assert.equal(url, "https://smmxpert.com/api/v2");
    assert.equal(init.redirect, "error");
    assert.deepEqual(Object.fromEntries(init.body), {
      key: "test",
      action: "add",
      quantity: "50",
      service: "4",
      link: "https://example.com/post",
    });
    return Response.json({ order: 123 });
  });
  assert.equal(await p.submit(4, "https://example.com/post", 50), "123");
  assert.equal(calls, 1);
});
test("batch limits and provider rejections", async () => {
  const p = new Provider("test", async () => Response.json({ error: "test" }));
  assert.throws(() => p.statuses(Array(101).fill("1")));
  await assert.rejects(p.statuses(["1"]));
  await assert.rejects(p.submit(4, "javascript:alert(1)", 50));
});
test("payment signature uses exact body bytes", () => {
  const sig = createHmac("sha256", "test").update("{}").digest("hex");
  assert.ok(signatureOK("{}", sig, "test"));
  assert.equal(signatureOK("{ }", sig, "test"), false);
  assert.equal(signatureOK("{}", "bad", "test"), false);
});
test("admin operations reject anonymous calls before database access", async () => {
  const res = await operations.fetch(
    new Request("https://voxx.in/api/operations", { method: "POST" }),
  );
  assert.equal(res.status, 401);
});
