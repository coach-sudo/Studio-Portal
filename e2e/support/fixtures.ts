import { expect, test as base } from "@playwright/test";
import {
  readRuntime,
  storageStatePath,
  type E2ERuntime,
  type FixtureRole,
} from "./runtime";

type Fixtures = { runtime: E2ERuntime };

export const test = base.extend<Fixtures>({
  // Playwright requires the first fixture argument to use object destructuring.
  // eslint-disable-next-line no-empty-pattern
  runtime: async ({}, use) => use(await readRuntime()),
});

export { expect };

export function requireFixtures(runtime: E2ERuntime) {
  test.skip(
    !runtime.fixtureReady,
    `BLOCKED: ${runtime.blockedReason || "staging fixture setup is unavailable"}`,
  );
}

export function requireCapability(
  runtime: E2ERuntime,
  capability: "google" | "stripeTest",
  reason: string,
) {
  requireFixtures(runtime);
  test.skip(!runtime.capabilities?.[capability], `BLOCKED: ${reason}`);
}

export function useRole(role: FixtureRole) {
  test.use({ storageState: storageStatePath(role) });
}

export async function expectNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport + 1);
}
