import {
  test,
  expect,
  checkedRequest,
  roleHeaders,
  hostedAcceptance,
} from "../support/hostedReadOnly";
import { creditCoverageSchema } from "../../src/domain/creditCoverage";
import { formatMoney } from "../../src/domain/finance";
import type { Page } from "@playwright/test";

const studentPath = `/coach/students/${hostedAcceptance.student}`;
async function settled(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByText(/Something went wrong|Unable to load your studio/),
  ).toHaveCount(0);
}

for (const role of ["coach", "student", "guardian"] as const) {
  test.describe(`${role} hosted depth`, () => {
    test.use({ role });
    test("@responsive real V2 snapshot transport and identity survive navigation and reload", async ({
      page,
    }) => {
      const snapshots: number[] = [];
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (
          url.origin === `https://${hostedAcceptance.project}.supabase.co` &&
          url.pathname === "/rest/v1/rpc/studio_route_snapshot"
        )
          snapshots.push(response.status());
      });
      const path = role === "coach" ? "/coach/today" : "/portal";
      await settled(page, path);
      await page.reload();
      await page.waitForLoadState("networkidle");
      expect(snapshots.length).toBeGreaterThan(0);
      expect(snapshots.every((status) => status === 200)).toBe(true);
      await expect(page.getByLabel("Sign out", { exact: true })).toBeAttached();
    });

    test("@responsive UI financial totals agree with real authorized reads after navigation and refresh", async ({
      page,
      context,
    }) => {
      const headers = await roleHeaders(role);
      const rpc = (name: string) =>
        checkedRequest(
          context.request,
          "POST",
          `https://${hostedAcceptance.project}.supabase.co/rest/v1/rpc/${name}`,
          { headers, data: { p_student: hostedAcceptance.student } },
        );
      const financeResponse = await rpc("student_financial_overview");
      expect(financeResponse.status()).toBe(200);
      const finance: {
        studentId: string;
        balances: {
          currency: string;
          dueMinor: number;
          dollarCreditMinor: number;
        }[];
      } = await financeResponse.json();
      expect(finance.studentId).toBe(hostedAcceptance.student);
      expect(Array.isArray(finance.balances)).toBe(true);
      const creditResponse = await rpc("student_credit_coverage");
      expect(creditResponse.status()).toBe(200);
      const credit = creditCoverageSchema.parse(await creditResponse.json());
      const path =
        role === "coach" ? `${studentPath}/payments` : "/portal/payments";
      const metrics = async () => {
        const account = page
          .locator("section.section")
          .filter({
            has: page.getByRole("heading", {
              name: "Account summary",
              exact: true,
            }),
          })
          .last();
        const credits = page
          .locator("section.section")
          .filter({
            has: page.getByRole("heading", {
              name: "Lesson credits",
              exact: true,
            }),
          })
          .last();
        await expect(account).toBeVisible();
        await expect(
          credits.getByText("Remaining", { exact: true }),
        ).toBeVisible();
        for (const balance of finance.balances) {
          for (const [label, amount] of [
            [`Amount due · ${balance.currency}`, balance.dueMinor],
            [
              `Dollar account credit · ${balance.currency}`,
              balance.dollarCreditMinor,
            ],
          ] as const) {
            const metric = account
              .locator(".account-metrics > div")
              .filter({ has: page.getByText(label, { exact: true }) });
            await expect(metric.locator("strong")).toHaveText(
              formatMoney(amount, balance.currency),
            );
          }
        }
        for (const [label, amount] of [
          ["Remaining", credit.summary.remaining],
          ["Available", credit.summary.available],
          ["Reserved", credit.summary.reserved],
        ] as const) {
          const metric = credits
            .locator(".account-metrics > div")
            .filter({ has: page.getByText(label, { exact: true }) });
          await expect(metric.locator("strong")).toHaveText(String(amount));
        }
        if (role !== "coach") {
          await expect(
            credits.getByText("Your coach manages this setting.", {
              exact: true,
            }),
          ).toBeVisible();
          await expect(
            credits.getByRole("button", {
              name: /Adjust credits|Review and enable|Turn off|Apply eligible credits now/,
            }),
          ).toHaveCount(0);
        }
        return {
          account: await account.locator(".account-metrics").innerText(),
          credit: await credits.locator(".account-metrics").innerText(),
        };
      };
      await settled(page, path);
      const before = await metrics();
      await settled(
        page,
        role === "coach" ? `${studentPath}/household` : "/portal/settings",
      );
      await settled(page, path);
      expect(await metrics()).toEqual(before);
      await page.reload();
      await page.waitForLoadState("networkidle");
      expect(await metrics()).toEqual(before);
    });

    test("authenticated invoice HTTP wrapper returns caller-visible empty invoices", async ({
      context,
    }) => {
      const response = await checkedRequest(
        context.request,
        "GET",
        "/api/invoices",
        { headers: await roleHeaders(role) },
      );
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual({ invoices: [] });
    });
    test("missing lesson detail returns safely to the authorized lesson list", async ({
      page,
    }) => {
      const missing = "00000000-0000-4000-8000-000000000001";
      const list =
        role === "coach" ? `${studentPath}/lessons` : "/portal/bookings";
      await page.goto(
        role === "coach" ? `${list}/${missing}` : `/portal/lessons/${missing}`,
      );
      await expect(page).toHaveURL(`${hostedAcceptance.origin}${list}`);
      await expect(page.locator("main")).toBeVisible();
    });
  });
}

test.describe("coach safe reviews", () => {
  test.use({ role: "coach" });
  test("summary loading transitions to the real empty response without a mock", async ({
    page,
  }, info) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(
      "**/rest/v1/rpc/student_workspace_summary",
      async (route) => {
        await gate;
        await route.fallback();
      },
    );
    try {
      await page.goto(studentPath);
      await expect(
        page.getByText("Loading current context…", { exact: true }),
      ).toBeVisible();
    } finally {
      release();
    }
    await expect(
      page.getByText("Nothing scheduled", { exact: true }),
    ).toBeVisible();
    info.annotations.push({
      type: "real-response-with-delay",
      description:
        "Only request timing was delayed locally; the actual hosted response continued unchanged through the read fence.",
    });
  });
  test("Household responsibilities and permissions open without saving or inviting", async ({
    page,
  }) => {
    await settled(page, `${studentPath}/household`);
    await expect(
      page.getByText("Portal access on", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Activation: not verified", { exact: true }),
    ).toBeVisible();
    const opener = page.getByRole("button", {
      name: "Manage Access",
      exact: true,
    });
    await opener.click();
    const drawer = page.getByRole("dialog", { name: /Manage Access/ });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByLabel("View payments", { exact: true }),
    ).toBeChecked();
    await expect(
      drawer.getByLabel("View schedule", { exact: true }),
    ).toBeChecked();
    await expect(
      drawer.getByLabel("Manage profile", { exact: true }),
    ).not.toBeChecked();
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
  test("automatic credit preview is a read; closing preserves the setting", async ({
    page,
  }) => {
    await settled(page, `${studentPath}/payments`);
    const setting = page.getByText(/Use credits automatically:/);
    const before = await setting.innerText();
    await page
      .getByRole("button", { name: "Review and enable", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Enable automatic credit use",
      exact: true,
    });
    await expect(
      dialog.getByText(/This preview does not save the setting/),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Keep current setting", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(setting).toHaveText(before);
  });
  test("bounded candidate read wrapper returns no lessons and creates no review", async ({
    context,
  }) => {
    const response = await checkedRequest(
      context.request,
      "POST",
      "/api/v2/lessons",
      {
        headers: await roleHeaders("coach"),
        data: {
          command: "bulk_candidates",
          payload: {
            filter: { studentId: hostedAcceptance.student },
            offset: 0,
            limit: 10,
          },
          reason: "Read-only hosted candidate acceptance",
          expectedVersion: 0,
          idempotencyKey: "readonly-candidates-830",
        },
      },
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.resource).toMatchObject({
      count: 0,
      items: [],
      offset: 0,
      limit: 10,
    });
    expect(body.queuedSideEffects).toEqual([]);
  });
  test("unknown student route returns safely to the roster", async ({
    page,
  }) => {
    await page.goto("/coach/students/00000000-0000-4000-8000-000000000001");
    await expect(page).toHaveURL(`${hostedAcceptance.origin}/coach/students`);
    await expect(page.locator(".student-record-identity")).toHaveCount(0);
  });
});

for (const role of ["student", "guardian", "unrelated"] as const) {
  test.describe(`${role} direct-route fences`, () => {
    test.use({ role, expectedBlockedPaths: ["/api/v2/auth/claim-access"] });
    test("coach finance, household and administration never expose their workspace", async ({
      page,
      guard,
    }) => {
      for (const path of [
        "/coach/finance",
        `${studentPath}/household`,
        "/coach/settings",
      ]) {
        await page.goto(path);
        await expect(page).toHaveURL(`${hostedAcceptance.origin}/`);
        await expect(
          page.getByRole("navigation", {
            name: "Coach navigation",
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(page.locator(".student-record-identity")).toHaveCount(0);
      }
      await expect
        .poll(() => guard.some((r) => r.path === "/api/v2/auth/claim-access"))
        .toBe(true);
    });
  });
}

test.describe("unrelated private reads", () => {
  test.use({ role: "unrelated" });
  test("private schedules, household, finance and administration are denied by RLS", async ({
    context,
  }) => {
    const headers = await roleHeaders("unrelated");
    for (const table of [
      "memberships",
      "lessons",
      "lesson_participants",
      "calendar_projections",
      "studio_invoices",
      "outbox_messages",
      "portal_accounts",
      "audit_events",
    ]) {
      const response = await checkedRequest(
        context.request,
        "GET",
        `https://${hostedAcceptance.project}.supabase.co/rest/v1/${table}?select=*&limit=5`,
        { headers },
      );
      expect(response.status()).toBe(200);
      expect(await response.json()).toEqual([]);
    }
  });
});

for (const feature of [
  "coach exact existing lesson",
  "student exact existing lesson",
  "guardian exact existing lesson",
  "nonzero financial and populated history",
]) {
  test(`fixture boundary: ${feature}`, async ({ role }, info) => {
    info.annotations.push({
      type: "blocked",
      description:
        "Verified existing fixtures contain no lessons, lots, invoices or notes; business writes are not authorized.",
    });
    test.skip(
      Boolean(role),
      "Requires separately authorized hosted fixtures; never substitute local mocked results.",
    );
  });
}
