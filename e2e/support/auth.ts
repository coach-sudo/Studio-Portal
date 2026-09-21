import type { Browser, BrowserContext, Page } from "@playwright/test";
import { readRuntime, type FixtureRole } from "./runtime";

export async function openAs(
  browser: Browser,
  role: FixtureRole,
): Promise<{ context: BrowserContext; page: Page }> {
  const runtime = await readRuntime();
  const context = await browser.newContext({
    baseURL: runtime.baseURL,
    bypassCSP: process.env.E2E_EPHEMERAL === "true",
  });
  const page = await context.newPage();
  const account = runtime.accounts?.[role];
  if (!account) {
    await context.close();
    throw new Error(`fixture response omitted ${role} credentials`);
  }
  await page.goto("/login");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Password").fill(account.password);
  await Promise.all([
    page.waitForURL(/\/(portal|coach)(?:\/|$)/, { timeout: 30_000 }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  return { context, page };
}

export async function accessToken(page: Page) {
  return page.evaluate(() => {
    for (const value of Object.values(localStorage)) {
      try {
        const parsed = JSON.parse(value) as {
          access_token?: string;
          currentSession?: { access_token?: string };
        };
        const token =
          parsed.access_token || parsed.currentSession?.access_token;
        if (token) return token;
      } catch {
        // Non-JSON application preferences are unrelated to authentication.
      }
    }
    return "";
  });
}
