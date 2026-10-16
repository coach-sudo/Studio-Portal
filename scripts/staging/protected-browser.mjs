import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { createInterface } from "node:readline/promises";
import process from "node:process";
import console from "node:console";
/* global localStorage */

const project = "lrxrivfqjpkvygozphoz";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function deploymentOrigin(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/^[a-f0-9]{24}--coachd-staging\.netlify\.app$/.test(url.hostname)
  )
    throw Error("Use the exact immutable staging deployment origin");
  return url.origin;
}

export function privatePath(value) {
  if (!value || !isAbsolute(value))
    throw Error("An absolute private file path is required");
  const path = resolve(value),
    fromRepo = relative(repo, path);
  if (
    !fromRepo ||
    (fromRepo !== ".." &&
      !fromRepo.startsWith(`..${sep}`) &&
      !isAbsolute(fromRepo))
  )
    throw Error("Authentication files must be outside the repository");
  return path;
}

export function perimeterState(state, origin, now = Date.now() / 1000) {
  const host = new URL(deploymentOrigin(origin)).hostname;
  if (!Array.isArray(state.cookies) || !state.cookies.length)
    throw Error("No perimeter cookies captured");
  const cookies = state.cookies.filter(
    (cookie) =>
      cookie.domain.replace(/^\./, "") === host &&
      cookie.secure &&
      (cookie.expires === -1 || cookie.expires > now + 120),
  );
  if (!cookies.length)
    throw Error("No unexpired cookies for the exact deployment host");
  // Never copy dashboard sessions, application localStorage, or broad parent cookies.
  return { cookies, origins: [] };
}

async function main() {
  const [mode, url, stateFile, credentialsFile, candidate] =
    process.argv.slice(2);
  if (!mode || mode === "--help") {
    console.log(
      "Prepare only; never deploys or calls fixture/worker endpoints.\n" +
        "  node scripts/staging/protected-browser.mjs capture HTTPS_DEPLOY_ORIGIN ABSOLUTE_PRIVATE_STATE_PATH\n" +
        "  node scripts/staging/protected-browser.mjs check HTTPS_DEPLOY_ORIGIN ABSOLUTE_PRIVATE_STATE_PATH ABSOLUTE_CREDENTIALS_PATH FULL_CANDIDATE_SHA\n" +
        "Capture requires the authorized reviewer to complete normal Netlify team login. Check signs in existing synthetic accounts only; run after deployment/auth-check approval.",
    );
    return;
  }
  if (!["capture", "check"].includes(mode)) throw Error("Unknown mode");
  const origin = deploymentOrigin(url),
    statePath = privatePath(stateFile);
  if (mode === "check" && !/^[a-f0-9]{40}$/.test(candidate || ""))
    throw Error("Full reviewed candidate SHA is required");
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: mode !== "capture" });
  try {
    if (mode === "capture") {
      // Keep application service workers from obscuring intercepted requests.
      const context = await browser.newContext({ serviceWorkers: "block" });
      const page = await context.newPage();
      await page.goto(`${origin}/login`);
      const prompt = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        await prompt.question(
          "Complete Netlify team login in this browser. When the portal Sign in screen is visible, press Enter here. ",
        );
      } finally {
        prompt.close();
      }
      if (
        new URL(page.url()).origin !== origin ||
        (await page
          .getByLabel("Email or username", { exact: true })
          .count()) !== 1
      )
        throw Error("Protected portal sign-in screen was not reached");
      const state = perimeterState(await context.storageState(), origin);
      await mkdir(dirname(statePath), { recursive: true });
      await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
      console.log(
        "Perimeter-only state saved outside Git. Apply Owner/SYSTEM NTFS ACLs on Windows before reuse.",
      );
      return;
    }
    const state = perimeterState(
      JSON.parse(await readFile(statePath, "utf8")),
      origin,
    );
    const credentials = JSON.parse(
      await readFile(privatePath(credentialsFile), "utf8"),
    );
    if (
      credentials.project !== project ||
      credentials.studio !== "4ceff683-e72f-4b2e-96ce-85db2dca4eb2"
    )
      throw Error("Synthetic project/studio mismatch");
    for (const role of ["coach", "student", "guardian"]) {
      const account = credentials.accounts?.[role];
      if (
        !account?.email?.endsWith("@coachd-staging.example.test") ||
        !account.password ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          account.id || "",
        )
      )
        throw Error("Existing synthetic credentials are required");
      const context = await browser.newContext({
        baseURL: origin,
        storageState: state,
        serviceWorkers: "block",
      });
      try {
        const health = await context.request.get("/api/healthz", {
          maxRedirects: 0,
        });
        if (!health.ok())
          throw Error("Perimeter session unavailable or expired");
        const body = await health.json();
        if (
          body.release?.context !== "deploy-preview" ||
          body.release?.commit !== candidate.slice(0, 12)
        )
          throw Error("Deployed release identity mismatch");
        let denied = false;
        await context.route("**/*", async (route) => {
          const target = new URL(route.request().url());
          if (
            [
              new URL(origin).hostname,
              `${project}.supabase.co`,
              "fonts.googleapis.com",
              "fonts.gstatic.com",
            ].includes(target.hostname) &&
            target.protocol === "https:"
          )
            return route.continue();
          denied = true;
          return route.abort();
        });
        const page = await context.newPage();
        await page.goto("/login");
        await page
          .getByLabel("Email or username", { exact: true })
          .fill(account.email);
        await page
          .getByLabel("Password", { exact: true })
          .fill(account.password);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await page.waitForURL(
          role === "coach" ? /\/coach(?:\/|$)/ : /\/portal(?:\/|$)/,
        );
        const userId = await page.evaluate((key) => {
          const session = JSON.parse(localStorage.getItem(key) || "null");
          return session?.user?.id;
        }, `sb-${project}-auth-token`);
        if (userId !== account.id || denied)
          throw Error("Identity or network isolation mismatch");
        console.log(
          `${role}: protected password login and expected synthetic identity verified`,
        );
      } finally {
        await context.close();
      }
    }
    console.log(
      "No app auth sessions persisted; no fixtures, messages, providers or workers requested.",
    );
  } finally {
    await browser.close();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main().catch(() => {
    console.error(
      "Protected browser preparation/check failed; no credentials or response bodies logged.",
    );
    process.exitCode = 1;
  });
