import { openAs, accessToken } from "./support/auth";
import { expect, requireFixtures, test } from "./support/fixtures";

test("@journey Journey 01: sign-in persists across a protected nested refresh and signs out", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  const { context, page } = await openAs(browser, "signout");
  await page.goto("/portal/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/portal\/settings/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});

test("@journey Journey 11: guardian sees the permitted household but not an unrelated student", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  const { context, page } = await openAs(browser, "guardian");
  await page.goto("/portal");
  await expect(
    page.getByText("E2E Student", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByLabel("Household context")).toContainText("workspace");
  await expect(
    page.getByText(`${runtime.runId} Unrelated`, { exact: false }),
  ).toHaveCount(0);
  await context.close();
});

test("@journey Journey 12: student is denied coach route and coach-only data", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  const { context, page } = await openAs(browser, "student");
  await page.goto("/coach/settings");
  await expect(page).not.toHaveURL(/\/coach\/settings/);

  await page.goto("/portal");
  const token = await accessToken(page);
  expect(token).not.toBe("");
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  expect(supabaseUrl).toBeTruthy();
  expect(anonKey).toBeTruthy();
  const response = await context.request.get(
    `${supabaseUrl}/rest/v1/memberships?select=id&role=eq.coach`,
    {
      headers: {
        apikey: anonKey!,
        Authorization: `Bearer ${token}`,
      },
    },
  );
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual([]);
  await context.close();
});

test("@journey Journey 12: unrelated student cannot obtain another student's fixture rows", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  const { context, page } = await openAs(browser, "unrelated");
  await page.goto("/portal/work");
  await expect(page.getByText(`${runtime.runId} Current work`)).toHaveCount(0);
  await expect(page.getByText(`${runtime.runId} Fixture material`)).toHaveCount(
    0,
  );
  await context.close();
});
