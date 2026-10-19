import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  credentials,
  checkedRequest,
  roleHeaders,
  hostedAcceptance,
  acceptanceDirectory,
  type Role,
} from "../support/hostedReadOnly";
import { creditCoverageSchema } from "../../src/domain/creditCoverage";

const coachStudent = `/coach/students/${hostedAcceptance.student}`;
const routes = {
  coach: [
    "/coach",
    "/coach/today",
    "/coach/bookings",
    "/coach/students",
    "/coach/inbox",
    "/coach/materials",
    "/coach/finance",
    "/coach/settings",
    coachStudent,
    `${coachStudent}/household`,
    `${coachStudent}/payments`,
    `${coachStudent}/lessons`,
    `${coachStudent}/work`,
    `${coachStudent}/notes`,
  ],
  student: [
    "/portal",
    "/portal/work",
    "/portal/bookings",
    "/portal/inbox",
    "/portal/payments",
    "/portal/settings",
    "/portal/actor-page",
    "/portal/referrals",
  ],
  guardian: [
    "/portal",
    "/portal/work",
    "/portal/bookings",
    "/portal/inbox",
    "/portal/payments",
    "/portal/settings",
  ],
} as const;

async function settled(page: import("@playwright/test").Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main")).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Opening the studio…" }),
  ).toHaveCount(0);
  await expect(page.locator("main")).not.toBeEmpty();
  await expect(
    page.getByText(
      /Something went wrong|Unable to load your studio|Database configuration is unavailable/i,
    ),
  ).toHaveCount(0);
}

for (const role of ["coach", "student", "guardian"] as const) {
  test.describe(role, () => {
    test.use({ role });
    test("session identity, refresh and isolation", async ({ page }) => {
      await settled(page, role === "coach" ? "/coach" : "/portal");
      const expectedId = (await credentials()).accounts[role].id;
      const identity = () =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) || "null")?.user?.id,
          `sb-${hostedAcceptance.project}-auth-token`,
        );
      expect((await identity()) === expectedId).toBe(true);
      await page.reload();
      await expect(page.locator("main")).toBeVisible();
      expect((await identity()) === expectedId).toBe(true);
    });
    for (const path of routes[role])
      test(`navigation ${path}`, async ({ page }) => {
        await settled(page, path);
        expect(new URL(page.url()).pathname).toBe(path);
        await expect(
          page.getByLabel("Sign out", { exact: true }),
        ).toBeAttached();
      });

    test("@responsive home, work and payments: overflow, landmarks, axe", async ({
      page,
    }, info) => {
      const checks =
        role === "coach"
          ? [
              coachStudent,
              `${coachStudent}/household`,
              `${coachStudent}/payments`,
            ]
          : ["/portal", "/portal/work", "/portal/payments"];
      const findings: unknown[] = [];
      for (const path of checks) {
        await settled(page, path);
        await expect(page.locator("main h1,main h2").first()).toBeVisible();
        // Wait for bounded financial reads, rather than scoring loading skeletons.
        await page.waitForLoadState("networkidle");
        const size = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          content: document.documentElement.scrollWidth,
        }));
        const axe = await new AxeBuilder({ page }).analyze();
        findings.push({
          path,
          size,
          violations: axe.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              failureSummary: n.failureSummary,
            })),
          })),
        });
        await page.screenshot({
          path: `${acceptanceDirectory}/${role}-${info.project.name}-${path.split("/").pop() || "home"}.png`,
          fullPage: true,
          mask: [page.locator('input[type="password"]')],
        });
      }
      await info.attach("sanitized-layout-accessibility", {
        body: JSON.stringify(findings),
        contentType: "application/json",
      });
      for (const finding of findings as {
        path: string;
        size: { width: number; content: number };
        violations: { id: string; impact: string | null }[];
      }[]) {
        expect
          .soft(finding.size.content, `Horizontal overflow: ${finding.path}`)
          .toBeLessThanOrEqual(finding.size.width + 1);
        expect
          .soft(
            finding.violations.filter((v) =>
              ["serious", "critical"].includes(v.impact || ""),
            ),
            `Accessibility: ${finding.path}`,
          )
          .toEqual([]);
      }
    });

    test("authorized finance and coverage agree with empty synthetic account", async ({
      context,
    }) => {
      const headers = await roleHeaders(role);
      const finance = await checkedRequest(
        context.request,
        "POST",
        `https://${hostedAcceptance.project}.supabase.co/rest/v1/rpc/student_financial_overview`,
        { headers, data: { p_student: hostedAcceptance.student } },
      );
      expect(finance.status()).toBe(200);
      const summary = await finance.json();
      expect(summary.studentId).toBe(hostedAcceptance.student);
      expect(summary.reviewRequired).toBe(false);
      expect(summary.activePackages).toBe(0);
      expect(summary.pendingPayments).toBe(0);
      expect(
        summary.balances.every(
          (b: { dueMinor: number; dollarCreditMinor: number }) =>
            b.dueMinor === 0 && b.dollarCreditMinor === 0,
        ),
      ).toBe(true);
      const coverage = await checkedRequest(
        context.request,
        "POST",
        `https://${hostedAcceptance.project}.supabase.co/rest/v1/rpc/student_credit_coverage`,
        {
          headers,
          data: {
            p_student: hostedAcceptance.student,
            p_page: 1,
            p_page_size: 25,
            p_preview_enable: false,
          },
        },
      );
      expect(coverage.status()).toBe(200);
      const value = creditCoverageSchema.parse(await coverage.json());
      expect(value.studentId).toBe(hostedAcceptance.student);
      // Persisted fixture contains no lessons, lots, ledger entries or account row.
      expect(JSON.stringify(value).includes("reconciliation_required")).toBe(
        false,
      );
    });
  });
}

for (const role of ["student", "guardian", "unrelated"] as Role[])
  test.describe(`${role} authorization`, () => {
    test.use({ role });
    test("coach workspace summary denied without disclosure", async ({
      context,
    }) => {
      const response = await checkedRequest(
        context.request,
        "POST",
        `https://${hostedAcceptance.project}.supabase.co/rest/v1/rpc/student_workspace_summary`,
        {
          headers: await roleHeaders(role),
          data: { p_student: hostedAcceptance.student },
        },
      );
      // Existing P0001 FORBIDDEN exceptions map to HTTP 400 in PostgREST.
      expect(response.status()).toBe(400);
      const denied = await response.json();
      expect(denied.code).toBe("P0001");
      expect(denied.message).toBe("FORBIDDEN");
      expect(JSON.stringify(denied).includes(hostedAcceptance.student)).toBe(
        false,
      );
    });
    test("private credit schema remains unavailable", async ({ context }) => {
      const response = await checkedRequest(
        context.request,
        "GET",
        `https://${hostedAcceptance.project}.supabase.co/rest/v1/credit_command_receipts?select=*`,
        {
          headers: {
            ...(await roleHeaders(role)),
            "accept-profile": "credit_internal",
          },
        },
      );
      expect([403, 404, 406]).toContain(response.status());
    });
    test("forged student financial read denied", async ({ context }) => {
      const response = await checkedRequest(
        context.request,
        "POST",
        `https://${hostedAcceptance.project}.supabase.co/rest/v1/rpc/student_financial_overview`,
        {
          headers: await roleHeaders(role),
          data: { p_student: "00000000-0000-4000-8000-000000000001" },
        },
      );
      expect([401, 403]).toContain(response.status());
    });
  });

test.describe("student boundaries", () => {
  test.use({
    role: "student",
    expectedBlockedPaths: ["/api/v2/auth/claim-access"],
  });
  test("coach route denies workspace; automatic access claim is blocked", async ({
    page,
    guard,
  }, info) => {
    await page.goto(coachStudent);
    await expect(page).toHaveURL(`${hostedAcceptance.origin}/`);
    await expect(
      page.getByRole("navigation", { name: "Coach navigation", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(() => guard.some((r) => r.path === "/api/v2/auth/claim-access"))
      .toBe(true);
    info.annotations.push({
      type: "blocked",
      description:
        "Redirect completion uses claim-access, which was never sent",
    });
  });
  test("keyboard focus reaches portal controls", async ({ page }) => {
    await settled(page, "/portal");
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => document.activeElement !== document.body),
    ).toBe(true);
  });
  test("200 percent zoom equivalent has no page overflow", async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 500 });
    await settled(page, "/portal/payments");
    const sizes = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(sizes.content).toBeLessThanOrEqual(sizes.width + 1);
  });
});

test.describe("unrelated boundaries", () => {
  test.use({ role: "unrelated" });
  test("student rows, contacts and ledger are not disclosed", async ({
    context,
  }) => {
    for (const table of [
      "students",
      "linked_contacts",
      "student_relationships",
      "package_credit_entries",
      "notes",
    ]) {
      const response = await checkedRequest(
        context.request,
        "GET",
        `https://${hostedAcceptance.project}.supabase.co/rest/v1/${table}?select=*&limit=5`,
        { headers: await roleHeaders("unrelated") },
      );
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual([]);
    }
    const response = await checkedRequest(
      context.request,
      "POST",
      `https://${hostedAcceptance.project}.supabase.co/rest/v1/rpc/student_credit_coverage`,
      {
        headers: await roleHeaders("unrelated"),
        data: { p_student: hostedAcceptance.student },
      },
    );
    expect([401, 403]).toContain(response.status());
  });
});

test.describe("session termination", () => {
  test.use({ role: "guardian" });
  test("logout removes application session while keeping Netlify perimeter", async ({
    page,
    context,
  }) => {
    await settled(page, "/portal");
    const logout = page.getByLabel("Sign out", { exact: true });
    await logout.click();
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByLabel("Email or username", { exact: true }),
    ).toBeVisible();
    const cleared = await page.evaluate(
      (key) => !JSON.parse(localStorage.getItem(key) || "null")?.access_token,
      `sb-${hostedAcceptance.project}-auth-token`,
    );
    expect(cleared).toBe(true);
    expect(
      (await checkedRequest(context.request, "GET", "/api/healthz")).ok(),
    ).toBe(true);
  });
});
