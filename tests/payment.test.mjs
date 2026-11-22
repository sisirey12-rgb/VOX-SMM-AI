import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import payment from "../api/payment.ts";
test("signed fixture webhook reaches settlement only after signature validation", async () => {
  const fetchBefore = global.fetch;
  const keys = {
    RAZORPAY_KEY_ID: "rzp_test_fixture",
    RAZORPAY_WEBHOOK_SECRET: "fixture",
    SUPABASE_URL: "https://fixture.invalid",
    SUPABASE_SECRET_KEY: "fixture",
  };
  const original = Object.fromEntries(
    Object.keys(keys).map((k) => [k, process.env[k]]),
  );
  Object.assign(process.env, keys);
  try {
    const body = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: "pay_fixture",
            order_id: "order_fixture",
            status: "captured",
            currency: "INR",
            amount: 10000,
          },
        },
      },
    });
    const signature = createHmac("sha256", "fixture")
      .update(body)
      .digest("hex");
    let calls = 0;
    global.fetch = async (url, options) => {
      assert.match(String(url), /rpc\/voxx_capture$/);
      assert.equal(JSON.parse(options.body).amount_paise, 10000);
      calls++;
      return new Response(null, { status: 204 });
    };
    const send = (sig) =>
      payment.fetch(
        new Request("https://voxx.in/api/payment?webhook=1", {
          method: "POST",
          headers: {
            "x-razorpay-event-id": "evt-fixture",
            "x-razorpay-signature": sig,
          },
          body,
        }),
      );
    assert.equal((await send("invalid")).status, 401);
    assert.equal(calls, 0);
    assert.equal((await send(signature)).status, 200);
    assert.equal(calls, 1);
  } finally {
    global.fetch = fetchBefore;
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
