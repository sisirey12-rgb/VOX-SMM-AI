import { chromium } from "playwright-core";
import { build } from "vite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const dir = await mkdtemp(join(tmpdir(), "voxx-smart-ui-")),
  user = crypto.randomUUID(),
  batch = crypto.randomUUID();
let browser;
try {
  await build({
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        "https://fixture.test",
      ),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        "publishable-fixture",
      ),
    },
    build: { outDir: dir, emptyOutDir: false },
    logLevel: "error",
  });
  browser = await chromium.launch({
    channel: process.env.CHROME_CHANNEL || "chrome",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 850 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let booked,
    level = 0,
    providerCalls = 0,
    accountRole = "admin";
  const now = Math.floor(Date.now() / 1000),
    expiry = now + 7200;
  const jwt =
    [
      { alg: "HS256", typ: "JWT" },
      { sub: user, exp: expiry, iat: now, role: "authenticated" },
    ]
      .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
      .join(".") + ".Zml4dHVyZQ";
  await page.addInitScript(
    ({ jwt, expiry, user }) =>
      localStorage.setItem(
        "sb-fixture-auth-token",
        JSON.stringify({
          access_token: jwt,
          refresh_token: "fixture",
          token_type: "bearer",
          expires_at: expiry,
          expires_in: 7200,
          user: {
            id: user,
            email: "test@example.com",
            aud: "authenticated",
            app_metadata: {},
            user_metadata: {},
            role: "authenticated",
            created_at: new Date(0).toISOString(),
          },
        }),
      ),
    { jwt, expiry, user },
  );
  await page.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.hostname === "voxx.test" && url.pathname === "/api/payment")
      return route.fulfill({ json: { mode: "test" } });
    if (url.hostname === "voxx.test")
      return route.fulfill({
        path: join(dir, url.pathname === "/" ? "/index.html" : url.pathname),
      });
    if (url.hostname !== "fixture.test") {
      if (url.hostname === "smmxpert.com") providerCalls++;
      return route.abort();
    }
    let reply = null;
    const action = url.pathname.split("/").at(-1);
    if (req.method() === "HEAD")
      return route.fulfill({ headers: { "content-range": "*/0" } });
    if (action === "voxx_role") reply = accountRole;
    if (action === "voxx_admin") reply = accountRole === "admin";
    if (action === "voxx_balance") reply = 12500;
    if (action === "voxx_notices") reply = [{ id: 1, title: "Fixture notice", body: "Ready", created_at: new Date(now * 1000).toISOString() }];
    if (action === "voxx_profiles" && url.searchParams.get("select") === "display_name") reply = { display_name: "Fixture name" };
    if (action === "voxx_site") reply = url.searchParams.get("select") === "welcome"
      ? { welcome: "VOXX" }
      : [{ welcome: "VOXX", created_at: new Date(now * 1000).toISOString() }];
    if (action === "voxx_catalogue")
      reply = {
        source: "live",
        items: [
          {
            id: 5,
            name: "Consultation",
            type: "Default",
            category: "Marketing",
            min: 5,
            max: 200,
            price: 100,
          },
        ],
      };
    if (action === "voxx_pacing") reply = { enabled: true };
    if (action === "voxx_schedule_rules")
      reply = url.searchParams.get("select") === "*"
        ? []
        : { min_minutes: 3, max_minutes: 120, max_runs: 150, fee_inr: 2 };
    if (action === "voxx_paced_quote") {
      const b = req.postDataJSON(),
        mins = b.requested_minutes ?? (b.pace === "slow" ? 600 : 300);
      reply = {
        pace: b.pace,
        duration: mins,
        quantity: b.total_units,
        hourly: (b.total_units * 60) / mins,
        rate: 100,
        subtotal: 100,
        baseFee: 2,
        hourFee: 3,
        fee: 2 + mins / 20,
        total: 102 + mins / 20,
        samples: 0,
        capacity: null,
        batches: [
          { offset: 0, quantity: 123, amount: 12.3 },
          { offset: mins, quantity: b.total_units - 123, amount: 87.7 },
        ],
      };
    }
    if (action === "voxx_book_paced") {
      booked = req.postDataJSON();
      reply = booked.seed;
    }
    if (action === "voxx_orders")
      reply = booked
        ? [
            {
              id: batch,
              campaign_id: booked.seed,
              service_name: "Consultation",
              quantity: 123,
              total_inr: 12.3,
              state: "Submitted",
              provider_status: null,
              target: "https://example.com",
              aftercare: null,
            },
          ]
        : [];
    if (action === "voxx_progress" && booked) {
      const events = [];
      for (let i = 0; i <= level; i++)
        events.push({
          batch,
          time: new Date((now + i * 15) * 1000).toISOString(),
          stage: ["pending", "accepted", "completed"][i],
          status: ["Awaiting review", "Submitted", "Completed"][i],
          submitted: i ? 123 : 0,
          accepted: i ? 123 : 0,
          completed: i === 2 ? 123 : 0,
        });
      reply = {
        [booked.seed]: {
          requested: 1000,
          created: events[0].time,
          batches: 2,
          campaignState: "Active",
          events,
        },
      };
    }
    return route.fulfill({ json: reply });
  });
  await page.goto("https://voxx.test");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "New Campaign", exact: true }).click();
  await page.getByRole("button", { name: /Consultation/ }).click();
  await page.getByLabel("Total campaign quantity").fill("1000");
  await page.getByLabel("Pace", { exact: true }).selectOption("custom");
  await page.getByLabel("First to last batch").fill("8");
  await page.getByText("View batch times and quantities").click();
  await page.getByRole("cell", { name: "8 h", exact: true }).waitFor();
  await page.getByLabel("Target URL").fill("https://example.com/campaign");
  await page.getByLabel("First batch (local time)").fill("2031-05-08T09:00");
  await page.getByRole("button", { name: /Confirm.*126/ }).click();
  const graph = (submitted, completed) =>
    page.getByRole("img", {
      name: new RegExp(
        "Submitted " +
          submitted +
          ", accepted " +
          submitted +
          ", completed " +
          completed +
          "$",
      ),
    });
  await graph(0, 0).waitFor();
  assert.equal(booked.total_units, 1000);
  assert.equal(booked.requested_minutes, 480);
  await page.getByRole("link", { name: "Full order details" }).click();
  await graph(0, 0).waitFor();
  level = 1;
  await graph(123, 0).waitFor({ timeout: 18000 });
  level = 2;
  await graph(123, 123).waitFor({ timeout: 18000 });
  await page.reload();
  await graph(123, 123).waitFor();
  await page.goto("https://voxx.test/");
  await graph(123, 123).waitFor();
  await page.getByText("₹125", { exact: false }).first().waitFor();
  await page.getByRole("button", { name: /Notifications, 1 unread/ }).click();
  const notices = page.getByRole("dialog", { name: "Recent notifications" });
  await notices.getByText("Fixture notice").waitFor();
  const noticeBounds = await notices.boundingBox();
  assert.ok(noticeBounds && noticeBounds.x >= 0 && noticeBounds.x + noticeBounds.width <= 390);
  await notices.getByRole("button", { name: "Mark shown as read" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Search pages" }).click();
  const search = page.getByRole("dialog", { name: "Find a workspace page" });
  await search.getByRole("searchbox").fill("notifications");
  await search.getByRole("button", { name: "Notifications" }).click();
  await page.getByRole("heading", { name: "Notifications", exact: true }).first().waitFor();
  await page.getByRole("searchbox", { name: "Filter loaded records" }).fill("fixture");
  await page.getByRole("button", { name: /View record 1/ }).click();
  await page.getByRole("dialog", { name: "Notifications record" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Notifications record" }).waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  async function checkSidebar() {
    const navigation = page.getByRole("navigation", { name: "Workspace navigation" });
    const buttons = navigation.getByRole("button");
    const labels = await buttons.allTextContents();
    for (const [i, label] of labels.entries()) {
      await buttons.nth(i).click();
      await page.locator("header h1").getByText(label, { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label);
      assert.deepEqual(errors, [], label);
    }
    return labels.length;
  }
  await page.getByRole("button", { name: "Admin", exact: true }).click();
  const adminRoutes = await checkSidebar();
  accountRole = "reseller";
  await page.reload();
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("button", { name: "Reseller", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Admin", exact: true }).count(), 0);
  const customerRoutes = await checkSidebar();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  const account = page.getByRole("dialog", { name: "Your VOXX account" });
  await account.getByRole("button", { name: "Account and security" }).click();
  await page.getByRole("textbox", { name: "Display name" }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Display name" }).inputValue(), "Fixture name");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Continue with Google" }).waitFor();
  await page.getByRole("button", { name: "Show password" }).click();
  assert.equal(await page.getByLabel("Password", { exact: true }).getAttribute("type"), "text");
  assert.equal(await page.getByRole("button", { name: "Admin", exact: true }).count(), 0);
  console.log(adminRoutes + " admin and " + customerRoutes + " customer/reseller pages rendered (fixture API).");
  assert.equal(providerCalls, 0);
  assert.deepEqual(errors, []);
  console.log(
    "Smart confirmation, automatic zero graph, two polling updates, detail reload and dashboard graph passed (fixture API).",
  );
} finally {
  if (browser) await browser.close();
  await rm(dir, { recursive: true, force: true });
}
