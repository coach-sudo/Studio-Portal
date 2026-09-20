import type { Browser, BrowserContext, Page } from "@playwright/test";
import { readRuntime, storageStatePath, type FixtureRole } from "./runtime";

export async function openAs(
  browser: Browser,
  role: FixtureRole,
): Promise<{ context: BrowserContext; page: Page }> {
  const runtime = await readRuntime();
  const context = await browser.newContext({
    baseURL: runtime.baseURL,
    storageState: storageStatePath(role),
  });
  return { context, page: await context.newPage() };
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
