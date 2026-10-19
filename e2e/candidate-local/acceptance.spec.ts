import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ids, installFixture } from "./fixture";

const studentPath = `/coach/students/${ids.student}`;
for (const long of [false, true])
  test(`guardian ${long ? "long" : "short"} household identity stays clear of the notification bell`, async ({
    page,
    context,
  }, info) => {
    const name = long
      ? "Alexandria-Margaret Montgomery de la Cruz-Journigan"
      : "E2E Candidate Student";
    await installFixture(context, "guardian", {
      student: name,
      guardian: long ? "Theodora Montgomery de la Cruz" : "Candidate Guardian",
      relationship: long
        ? "Authorized guardian and scheduling support person"
        : "Parent",
    });
    for (const path of ["/portal", "/portal/work", "/portal/payments"]) {
      await page.goto(path);
      const banner = page.getByRole("region", {
        name: "Household context",
        exact: true,
      });
      await expect(banner).toBeVisible();
      await expect(banner.locator("strong")).toContainText(name);
      const bell = await page.locator(".activity-bell").boundingBox();
      expect(bell).not.toBeNull();
      for (const locator of [
        banner.locator("strong"),
        banner.locator("span"),
      ]) {
        const text = await locator.boundingBox();
        expect(text).not.toBeNull();
        const overlaps =
          text!.x < bell!.x + bell!.width &&
          text!.x + text!.width > bell!.x &&
          text!.y < bell!.y + bell!.height &&
          text!.y + text!.height > bell!.y;
        expect(
          overlaps,
          "Bell must not cover household identity or relationship",
        ).toBe(false);
        expect(
          await locator.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        ).toBe(true);
      }
      await page.screenshot({
        path: info.outputPath(
          `guardian-${long ? "long" : "short"}-${path.split("/").pop()}.png`,
        ),
        fullPage: true,
      });
    }
  });
for (const role of ["student", "guardian"] as const)
  test(`${role}: account credit summary wraps without truncation`, async ({
    page,
    context,
  }) => {
    await installFixture(context, role);
    await page.goto("/portal");
    const account = page.getByRole("region", { name: "Account", exact: true });
    await expect(
      account.getByText("0 lesson credits available", { exact: true }),
    ).toBeVisible();
    for (const text of await account.locator("strong,small").all()) {
      expect(
        await text.evaluate((el) => getComputedStyle(el).textOverflow),
      ).not.toBe("ellipsis");
      expect(
        await text.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
    }
    await account
      .getByRole("button", { name: "View payments›", exact: true })
      .click();
    await expect(
      page.getByText("Amount due · USD", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Dollar account credit · USD", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Lesson credits", { exact: true }).first(),
    ).toBeVisible();
  });
for (const role of ["coach", "student", "guardian"] as const) {
  test(`${role}: real query transport, navigation, refresh, financial labels and responsive axe`, async ({
    page,
    context,
  }, info) => {
    const state = await installFixture(context, role);
    const paths =
      role === "coach"
        ? [
            studentPath,
            `${studentPath}/household`,
            `${studentPath}/payments`,
            `${studentPath}/lessons`,
            "/coach/today",
          ]
        : [
            "/portal",
            "/portal/bookings",
            "/portal/payments",
            "/portal/settings",
          ];
    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      if (path !== "/coach/today")
        await expect(page.locator("body")).toContainText(
          "E2E Candidate Student",
        );
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByText(/Something went wrong|Unable to load your studio/),
      ).toHaveCount(0);
      expect(new URL(page.url()).pathname).toBe(path);
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1,
        ),
      ).toBe(true);
      const axe = await new AxeBuilder({ page }).analyze();
      // The deployed candidate has unnamed sidebar/student complementary
      // landmarks. Keep the focused local fix covered in both query modes.
      expect(axe.violations.filter((v) => v.id === "landmark-unique")).toEqual(
        [],
      );
      expect(state.pageErrors).toEqual([]);
      await info.attach(`axe-${path.split("/").pop() || "overview"}`, {
        body: JSON.stringify(
          axe.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            targets: v.nodes.map((n) => n.target),
          })),
        ),
        contentType: "application/json",
      });
      expect(
        axe.violations
          .filter((v) => ["serious", "critical"].includes(v.impact || ""))
          .map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })),
      ).toEqual([]);
      if (path.endsWith("payments")) {
        await expect(
          page.getByText("Amount due · USD", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("Dollar account credit · USD", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("Lesson credits", { exact: true }).first(),
        ).toBeVisible();
        await expect(
          page.getByText("Credit coverage unavailable.", { exact: false }),
        ).toHaveCount(0);
        await page.screenshot({
          path: info.outputPath(`${role}-payments.png`),
          fullPage: true,
        });
      }
      if (
        path === `${studentPath}/household` &&
        page.viewportSize()!.width === 320
      ) {
        expect(
          (await page.locator(".student-record-identity h1").boundingBox())!
            .width,
        ).toBeGreaterThanOrEqual(140);
        await page.screenshot({
          path: info.outputPath("coach-header-320.png"),
          fullPage: true,
        });
      }
    }
    await page.reload();
    await expect(page.locator("main")).toBeVisible();
    expect(state.requests.includes("/rest/v1/rpc/studio_route_snapshot")).toBe(
      process.env.CANDIDATE_QUERY_MODE === "true",
    );
    if (process.env.CANDIDATE_QUERY_MODE === "false")
      expect(state.requests.includes("/rest/v1/lesson_list_rows")).toBe(true);
  });
}

test("coach: exact lesson link, selection, review form and search focus", async ({
  page,
  context,
}) => {
  await installFixture(context, "coach");
  await page.goto(studentPath);
  await expect(
    page.getByText("Candidate scene study", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(`a[href='${studentPath}/lessons/${ids.lesson}']`).first(),
  ).toBeVisible();
  const trigger =
    page.viewportSize()!.width <= 900
      ? page.getByRole("button", { name: "More", exact: true })
      : page.getByRole("button", {
          name: "Search studio workflows",
          exact: true,
        });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Go to", exact: true });
  await expect(
    dialog.getByLabel("Find a workflow", { exact: true }),
  ).toBeFocused();
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press("Tab");
    expect(
      await dialog.evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.goto(`${studentPath}/lessons`);
  await page
    .getByRole("checkbox", { name: /Select Candidate scene study/ })
    .check();
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.getByLabel("Bulk lesson action").selectOption("cancel");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Review/ }).last(),
  ).toBeVisible();
});

test("summary loading, failure without stale values, retry and empty state", async ({
  page,
  context,
}) => {
  const state = await installFixture(context, "coach");
  state.summaryDelay = 800;
  await page.goto(studentPath);
  await expect(
    page.getByText("Loading current context…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Candidate scene study", { exact: true }),
  ).toBeVisible();
  state.summaryFailure = true;
  await page.reload();
  await expect(
    page.getByText("Student summary unavailable.", { exact: true }),
  ).toBeVisible({ timeout: 18000 });
  await expect(
    page.getByText("Candidate scene study", { exact: true }),
  ).toHaveCount(0);
  state.summaryFailure = false;
  state.empty = true;
  await page
    .getByRole("button", { name: "Retry summary", exact: true })
    .click();
  await expect(
    page.getByText("Nothing scheduled", { exact: true }),
  ).toBeVisible();
});

test("forged student context returns to the roster without opening another record", async ({
  page,
  context,
}) => {
  await installFixture(context, "coach");
  await page.goto("/coach/students/70000000-0000-4000-8000-000000000099");
  await expect(page).toHaveURL(/\/coach\/students$/);
  await expect(
    page.getByRole("heading", { name: "Students", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".student-record-header")).toHaveCount(0);
});

test("unrelated account returns to login", async ({ page, context }) => {
  await installFixture(context, "unrelated");
  await page.goto("/portal");
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByText("E2E Candidate Student", { exact: true }),
  ).toHaveCount(0);
});

test("revoked guardian relationship denies a fresh direct route", async ({
  page,
  context,
}) => {
  const state = await installFixture(context, "guardian");
  await page.goto("/portal");
  await expect(page.locator("main")).toBeVisible();
  state.revoked = true;
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator("main")).not.toContainText("E2E Candidate Student");
});

test("local-only creation and editing use the real forms and command envelopes", async ({
  page,
  context,
}) => {
  const state = await installFixture(context, "coach");
  state.allowLocalMutation = true;
  await page.goto(studentPath);
  if (page.viewportSize()!.width < 600)
    await page.locator(".record-add-menu > summary").click();
  await page.getByRole("button", { name: "Add lesson", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Lesson focus", { exact: true })
    .fill("Local candidate lesson");
  await dialog.getByLabel("Start", { exact: true }).fill("2027-01-21T13:00");
  await dialog.getByRole("button", { name: "Add lesson", exact: true }).click();
  await expect(
    page.getByText("Lesson added to the schedule.", { exact: true }),
  ).toBeVisible();
  expect(state.commands.filter((c) => c === "create")).toHaveLength(1);
  await page.goto(`${studentPath}/lessons/${ids.lesson}`);
  await page
    .getByText("Payment, credits & lesson administration", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit lesson information", exact: true })
    .click();
  await page
    .getByLabel("Lesson topic", { exact: true })
    .fill("Updated candidate topic");
  await page
    .getByRole("button", { name: "Save lesson information", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Updated candidate topic", exact: true }),
  ).toBeVisible();
  expect(state.commands.filter((c) => c === "update_details")).toHaveLength(1);
});

test("local bulk review, confirmation, stale response and stable retry key", async ({
  page,
  context,
}) => {
  const state = await installFixture(context, "coach");
  state.allowLocalMutation = true;
  await page.goto(`${studentPath}/lessons`);
  await page
    .getByRole("checkbox", {
      name: "Select Candidate scene study",
      exact: true,
    })
    .check();
  await page.getByLabel("Bulk lesson action").selectOption("archive");
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Local browser archive review");
  await page.getByRole("button", { name: "Review batch", exact: true }).click();
  await expect(page.getByText("1 reviewed", { exact: true })).toBeVisible();
  const confirm = page.getByRole("button", { name: /Confirm archive/ });
  state.staleReview = true;
  await confirm.click();
  await expect(
    page.getByText("Reviewed records changed; review again.", { exact: true }),
  ).toBeVisible();
  expect(state.accepted).toBe(false);
  state.staleReview = false;
  await confirm.click();
  await expect(
    page.getByText("1 completed of 1", { exact: true }),
  ).toBeVisible();
  const keys = state.commands.flatMap((c, i) =>
    c === "execute_bulk" ? [state.keys[i]] : [],
  );
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
});

test("local reschedule conflict-check failure keeps the existing lesson", async ({
  page,
  context,
}) => {
  const state = await installFixture(context, "coach");
  await page.goto(`${studentPath}/lessons/${ids.lesson}`);
  await page.getByRole("button", { name: "Reschedule", exact: true }).click();
  await page.getByRole("button", { name: "Next day", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm new time", exact: true })
    .click();
  await expect(
    page.getByText("The booking command failed.", { exact: true }),
  ).toBeVisible();
  expect(
    state.commands.filter((c) => c === "reschedule" || c === "execute_change"),
  ).toHaveLength(0);
  await page
    .getByRole("button", { name: "Keep current time", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Candidate scene study", exact: true }),
  ).toBeVisible();
});

for (const role of ["student", "guardian"] as const)
  test(`${role}: exact lesson details and coach financial controls remain unavailable`, async ({
    page,
    context,
  }) => {
    await installFixture(context, role);
    await page.goto("/portal");
    await page
      .getByRole("button", { name: "View lesson›", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/portal/lessons/${ids.lesson}$`));
    await expect(
      page.getByRole("heading", { name: "Candidate scene study", exact: true }),
    ).toBeVisible();
    await page.goto("/portal/payments");
    await expect(
      page.getByText("Lesson credits", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Adjust lesson credits|Apply eligible credits now|Review and enable/,
      }),
    ).toHaveCount(0);
  });
