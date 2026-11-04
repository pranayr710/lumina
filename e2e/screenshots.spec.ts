import { test, expect } from "@playwright/test";

const SHOTS = "docs/images";
test.use({ viewport: { width: 1600, height: 900 } });

test("capture README screenshots", async ({ page }) => {
  // Landing
  await page.goto("http://localhost:3000");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/01-landing.png` });

  // Enter the orchestrator canvas
  await page.getByRole("button", { name: /Launch Orchestrator/i }).click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/02-canvas.png` });

  // Open the node library / sidebar if a toggle exists
  const sidebarToggles = page.locator("aside button, [data-testid*='sidebar'] button");
  if (await sidebarToggles.count()) {
    await sidebarToggles.first().click().catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/03-node-library.png` });
  }

  for (const [name, path] of [["04-dashboard", "/dashboard"], ["05-library", "/library"], ["06-logs", "/logs"]]) {
    await page.goto(`http://localhost:3000${path}`);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
  }
});
