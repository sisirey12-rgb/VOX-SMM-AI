import { chromium } from "playwright-core";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  channel: process.env.CHROME_CHANNEL || "chrome",
  headless: true,
});
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (u.hostname !== "voxx.test") return route.abort();
      return route.fulfill({
        path: "dist" + (u.pathname === "/" ? "/index.html" : u.pathname),
      });
    });
    await page.goto("https://voxx.test");
    await page
      .getByRole("heading", { name: "Overview", exact: true })
      .waitFor();
    if (width === 390)
      await page.getByRole("button", { name: "Open navigation" }).click();
    await page
      .getByRole("button", { name: "Service Catalogue", exact: true })
      .click();
    await page.getByRole("searchbox").fill("1001");
    await page.getByRole("button", { name: /Instagram Reel views/ }).click();
    assert.equal(
      await page.getByRole("heading", { name: "Instagram Reel views" }).count(),
      1,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    assert.deepEqual(errors, []);
    await page.close();
    console.log("Catalogue navigation and layout passed at " + width + "px");
  }
} finally {
  await browser.close();
}
