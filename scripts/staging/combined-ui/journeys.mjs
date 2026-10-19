/* global document, innerWidth */
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { plan, ids } from "./policy.mjs";
export async function workspaceViews(d, phase) {
  const coach = d.pages.coach,
    student = d.pages.student,
    guardian = d.pages.guardian;
  if (phase === "before-revocation") return;
  if (phase === "revoked") {
    await d.goto(`/portal?student=${ids.student}`, "guardian");
    await guardian.reload();
    await guardian.waitForLoadState("networkidle");
    d.check();
    await expect(
      guardian.getByRole("heading", {
        name: "Record unavailable",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      guardian.getByRole("region", { name: "Household context" }),
    ).toHaveCount(0);
    return;
  }
  assert.equal(phase, "wave2");
  const name = plan.runId + " Student 0",
    topic = plan.fixtureContent.lessons.find(
      (l) => l.id === ids["lesson-edit"],
    ).topic;
  await d.goto(
    `/coach/students?q=${encodeURIComponent(name)}&status=lead&sort=name`,
  );
  const roster = coach.url();
  await expect(
    coach.getByRole("textbox", { name: "Search students", exact: true }),
  ).toHaveValue(name);
  await coach.getByRole("button").filter({ hasText: name }).first().click();
  await expect(coach.getByRole("heading", { name, exact: true })).toBeVisible();
  await coach.getByRole("link", { name: "Lessons", exact: true }).click();
  await coach.locator(`a[href*="${ids["lesson-edit"]}"]`).first().click();
  await expect(coach).toHaveURL(new RegExp("/lessons/" + ids["lesson-edit"]));
  await coach.getByRole("button", { name: /Back/ }).last().click();
  await coach
    .getByRole("button", { name: "Back to students", exact: true })
    .click();
  await expect(coach).toHaveURL(roster);
  await coach.reload();
  await expect(
    coach.getByRole("textbox", { name: "Search students", exact: true }),
  ).toHaveValue(name);
  await coach.keyboard.press("Control+k");
  const query = coach.getByRole("combobox", {
    name: "Search records and destinations",
    exact: true,
  });
  await query.fill(name);
  await expect(
    coach.getByRole("option", { name: "Students: " + name, exact: true }),
  ).toBeVisible();
  await query.press("ArrowDown");
  await query.press("ArrowUp");
  await query.press("Enter");
  await expect(coach.getByRole("heading", { name, exact: true })).toBeVisible();
  await coach
    .getByRole("button", { name: "Back to students", exact: true })
    .click();
  await expect(coach).toHaveURL(roster);
  await d.goto("/coach/today");
  await expect(
    coach.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();
  // Exact Today action; no synthetic direct route substitutes for this click.
  const open = coach
    .getByRole("button", { name: "Open lesson", exact: true })
    .first();
  await expect(open).toBeVisible();
  await open.click();
  await expect(coach).toHaveURL(new RegExp(ids["lesson-edit"]));
  await coach.goBack();
  await expect(coach).toHaveURL(/\/coach\/today$/);
  await coach.goForward();
  await expect(coach).toHaveURL(new RegExp(ids["lesson-edit"]));
  await coach
    .getByRole("button", { name: "Write note", exact: true })
    .first()
    .click();
  const editor = coach.getByRole("textbox", { name: "Note", exact: true });
  await editor.fill("Unsaved acceptance draft; never submitted");
  const before = coach.url();
  coach.once("dialog", (dialog) => dialog.dismiss());
  await coach.goBack();
  await expect(coach).toHaveURL(before);
  await expect(editor).toHaveText("Unsaved acceptance draft; never submitted");
  coach.once("dialog", (dialog) => dialog.accept());
  await coach
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  await d.goto(`/portal?student=${ids.student}`, "student");
  await student
    .getByRole("link", { name: "My Work", exact: true })
    .first()
    .click();
  await expect(student).toHaveURL(/\/portal\/work/);
  await student
    .getByRole("link", { name: "Schedule", exact: true })
    .first()
    .click();
  await expect(student).toHaveURL(/\/portal\/bookings/);
  const schedule = student.url();
  await student
    .getByRole("button", { name: "Search portal", exact: true })
    .click();
  const studentSearch = student.getByRole("combobox", {
    name: "Search records and destinations",
    exact: true,
  });
  await studentSearch.fill(topic);
  await expect(
    student.getByRole("option", { name: "Lessons: " + topic, exact: true }),
  ).toBeVisible();
  await studentSearch.press("Enter");
  await expect(student.getByRole("main")).toContainText(topic);
  await student.goBack();
  await expect(student).toHaveURL(schedule);
  await d.goto(
    `/portal/records/note/${ids["note-draft"]}?student=${ids.student}`,
    "student",
  );
  await expect(
    student.getByRole("heading", { name: "Record unavailable", exact: true }),
  ).toBeVisible();
  await expect(
    student.getByText("PRIVATE DRAFT SENTINEL", { exact: true }),
  ).toHaveCount(0);
  await d.goto(`/portal?student=${ids.student}`, "guardian");
  const select = guardian.getByRole("combobox", {
    name: "Student",
    exact: true,
  });
  await expect(select).toHaveValue(ids.student);
  await select.selectOption(ids["other-student"]);
  await expect(guardian).toHaveURL(
    new RegExp("student=" + ids["other-student"]),
  );
  await guardian.reload();
  await expect(select).toHaveValue(ids["other-student"]);
  await guardian.goBack();
  await expect(select).toHaveValue(ids.student);
  await guardian.goForward();
  await expect(select).toHaveValue(ids["other-student"]);
  await d.goto(
    `/portal/records/resource/${ids["material-private"]}?student=${ids["other-student"]}`,
    "guardian",
  );
  await expect(
    guardian.getByRole("heading", { name: "Record unavailable", exact: true }),
  ).toBeVisible();
  await expect(
    guardian.getByText(plan.runId + " Private resource", { exact: true }),
  ).toHaveCount(0);
  await d.goto(`/portal?student=${ids.unavailable}`, "guardian");
  await expect(
    guardian.getByRole("heading", { name: "Record unavailable", exact: true }),
  ).toBeVisible();
  await expect(
    guardian.getByRole("region", { name: "Household context" }),
  ).toHaveCount(0);
  for (const [role, page, path] of [
    ["coach", coach, "/coach/today"],
    ["student", student, `/portal/work?student=${ids.student}`],
    ["guardian", guardian, `/portal?student=${ids.student}`],
  ]) {
    await d.goto(path, role);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      const audit = await new AxeBuilder({ page }).analyze();
      assert(
        !audit.violations.some((v) =>
          ["serious", "critical"].includes(v.impact),
        ),
        "Serious/critical application accessibility failure",
      );
      d.e.journal.append({
        type: "axe",
        name: `${d.engine || "chromium"}:${role}:${width}`,
        violations: audit.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          count: v.nodes.length,
        })),
      });
      if (role === "coach" && width <= 768) {
        const more = page.getByRole("button", { name: "More", exact: true });
        await more.click();
        const menu = page.getByRole("dialog", { name: "More", exact: true });
        await expect(
          menu.getByRole("link", { name: "Library", exact: true }),
        ).toBeVisible();
        await expect(
          menu.getByRole("link", { name: "Settings", exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        await expect(more).toBeFocused();
      }
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "200%"),
    );
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  d.viewsDone.push(phase);
  d.check();
  d.e.journal.append({
    type: "workspace-browser-proof",
    name: d.engine || "chromium",
    journeys: [
      "coach-return-filter-search-today",
      "dirty-note-declined-pop",
      "student-work-schedule-record",
      "guardian-two-context-refresh-history-forged",
      "four-width-axe-keyboard",
      "200-percent-text-reflow",
    ],
  });
}
