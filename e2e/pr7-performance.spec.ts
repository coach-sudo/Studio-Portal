import { writeFile } from "node:fs/promises";
import { expect, test } from "./support/fixtures";
import { storageStatePath, type FixtureRole } from "./support/runtime";

type RouteSample = {
  route: string;
  role: FixtureRole | "public";
  requestCount: number;
  dataRequestCount: number;
  transferBytes: number;
  javascriptBytes: number;
  stylesheetBytes: number;
  assets: { path: string; bytes: number }[];
};

test("@perf @mobile measures cold representative routes", async ({
  browser,
  runtime,
}, testInfo) => {
  test.skip(!runtime.fixtureReady, `BLOCKED: ${runtime.blockedReason}`);
  const routes: { route: string; role: RouteSample["role"] }[] = [
    { route: "/login", role: "public" },
    { route: "/book", role: "public" },
    { route: `/actors/${runtime.actorSlug}`, role: "public" },
    { route: "/portal", role: "student" },
    { route: `/portal/lessons/${runtime.ids?.lessonPending}`, role: "student" },
    { route: "/portal/inbox", role: "student" },
    { route: "/coach", role: "coach" },
    { route: `/coach/students/${runtime.ids?.student}`, role: "coach" },
  ];
  const samples: RouteSample[] = [];

  for (const { route, role } of routes) {
    const context = await browser.newContext({
      baseURL: runtime.baseURL,
      bypassCSP: process.env.E2E_EPHEMERAL === "true",
      viewport: testInfo.project.use.viewport,
      isMobile: testInfo.project.use.isMobile,
      hasTouch: testInfo.project.use.hasTouch,
      deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
      userAgent: testInfo.project.use.userAgent,
      serviceWorkers: "block",
      ...(role === "public" ? {} : { storageState: storageStatePath(role) }),
    });
    try {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      const requests: string[] = [];
      page.on("request", (request) => {
        try {
          requests.push(new URL(request.url()).pathname);
        } catch {
          // Browser-internal URLs have no useful route path.
        }
      });
      await page.goto(route);
      await expect(page.locator("h1").first()).toBeVisible({
        timeout: 30_000,
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      await page.waitForTimeout(500);
      const resources = await page.evaluate(() => {
        const entries = [
          ...performance.getEntriesByType("navigation"),
          ...performance.getEntriesByType("resource"),
        ] as PerformanceResourceTiming[];
        return entries.map((entry) => ({
          path: new URL(entry.name).pathname,
          bytes: entry.transferSize,
        }));
      });
      const assets = resources
        .filter((resource) => /\.(?:js|css)(?:$|\/)/.test(resource.path))
        .sort((left, right) => right.bytes - left.bytes);
      samples.push({
        route,
        role,
        requestCount: requests.length,
        dataRequestCount: requests.filter(
          (path) =>
            path.startsWith("/rest/v1/") ||
            path.startsWith("/auth/v1/") ||
            path.startsWith("/api/"),
        ).length,
        transferBytes: resources.reduce((sum, item) => sum + item.bytes, 0),
        javascriptBytes: assets
          .filter((item) => item.path.endsWith(".js"))
          .reduce((sum, item) => sum + item.bytes, 0),
        stylesheetBytes: assets
          .filter((item) => item.path.endsWith(".css"))
          .reduce((sum, item) => sum + item.bytes, 0),
        assets,
      });
    } finally {
      await context.close();
    }
  }

  const body = JSON.stringify(
    {
      method: "cold browser context; h1 visible, fonts ready, then 500 ms",
      project: testInfo.project.name,
      samples,
    },
    null,
    2,
  );
  await writeFile(testInfo.outputPath("route-performance.json"), `${body}\n`);
  await testInfo.attach("route-performance", {
    body,
    contentType: "application/json",
  });
});
