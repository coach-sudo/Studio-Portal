import { expect, test } from "@playwright/test";

test("staging exposes sanitized release liveness", async ({ request }) => {
  const response = await request.get("/api/healthz");
  expect(response.ok()).toBe(true);

  const body = (await response.json()) as Record<string, unknown>;
  expect(body.status).toBe("ok");
  expect(body.checkedAt).toEqual(expect.any(String));
  expect(body.release).toEqual(expect.any(Object));
  expect(body).not.toHaveProperty("supabase");
  expect(body).not.toHaveProperty("stripe");
  expect(body).not.toHaveProperty("issues");
});

test("staging app loads on desktop and mobile", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("body")).toBeVisible();
});
