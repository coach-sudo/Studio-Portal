import { chromium, type FullConfig } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { assertE2ERunId } from "../src/security/e2eSafety";
import {
  authDirectory,
  runtimePath,
  storageStatePath,
  type E2ERuntime,
  type FixtureRole,
} from "./support/runtime";

function runId() {
  const source =
    process.env.E2E_RUN_ID ||
    `e2e-${process.env.GITHUB_RUN_ID || "local"}-${process.env.GITHUB_RUN_ATTEMPT || Date.now().toString(36)}`;
  return assertE2ERunId(source.toLowerCase().slice(0, 50).replace(/-+$/g, ""));
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = String(config.projects[0]?.use.baseURL || "");
  const token = process.env.STAGING_E2E_FIXTURE_TOKEN || "";
  const runtime: E2ERuntime = {
    runId: runId(),
    baseURL,
    fixtureReady: false,
  };
  await mkdir(authDirectory, { recursive: true });
  if (!token) {
    runtime.blockedReason =
      "STAGING_E2E_FIXTURE_TOKEN is not configured for this CI context";
    await writeFile(runtimePath, JSON.stringify(runtime, null, 2));
    return;
  }

  try {
    const response = await fetch(`${baseURL}/api/e2e/fixtures`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-e2e-fixture-token": token,
      },
      body: JSON.stringify({ action: "setup", runId: runtime.runId }),
    });
    const payload = (await response.json()) as E2ERuntime & {
      message?: string;
    };
    if (!response.ok)
      throw new Error(
        payload.message || `fixture setup returned ${response.status}`,
      );
    Object.assign(runtime, payload, { fixtureReady: true, baseURL });
    await writeFile(runtimePath, JSON.stringify(runtime, null, 2));

    const browser = await chromium.launch();
    for (const role of [
      "coach",
      "student",
      "guardian",
      "unrelated",
      "signout",
    ] as FixtureRole[]) {
      const account = runtime.accounts?.[role];
      if (!account)
        throw new Error(`fixture response omitted ${role} credentials`);
      const context = await browser.newContext({
        baseURL,
        bypassCSP: process.env.E2E_EPHEMERAL === "true",
      });
      try {
        const page = await context.newPage();
        await page.goto("/login");
        await page.getByLabel("Username").fill(account.username);
        await page.getByLabel("Password").fill(account.password);
        await Promise.all([
          page.waitForURL(/\/(portal|coach)(?:\/|$)/, { timeout: 30_000 }),
          page.getByRole("button", { name: "Sign in" }).click(),
        ]);
        if (role === "coach") {
          await page.goto("/coach");
          await page.waitForURL(/\/coach(?:\/|$)/);
        }
        await context.storageState({ path: storageStatePath(role) });
      } catch (error) {
        throw new Error(
          `fixture authentication failed for ${role}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      } finally {
        await context.close();
      }
    }
    await browser.close();
  } catch (error) {
    try {
      await fetch(`${baseURL}/api/e2e/fixtures`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-e2e-fixture-token": token,
        },
        body: JSON.stringify({ action: "cleanup", runId: runtime.runId }),
      });
    } catch {
      // The primary setup error below remains the actionable blocked reason.
    }
    runtime.fixtureReady = false;
    runtime.blockedReason = `fixture setup failed: ${error instanceof Error ? error.message : String(error)}`;
    delete runtime.accounts;
    await writeFile(runtimePath, JSON.stringify(runtime, null, 2));
  }
}
