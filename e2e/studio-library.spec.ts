import {
  test,
  expect,
  requireFixtures,
  expectNoHorizontalOverflow,
} from "./support/fixtures";
import { openAs } from "./support/auth";
import { expectNoSeriousAxeViolations } from "./support/axe";

test("@journey @a11y Studio Library uploads once, assigns repeatedly, and preserves private catalog access", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  test.setTimeout(90000);
  const coach = await openAs(browser, "coach");
  const page = coach.page;
  let uploads = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes("/storage/v1/object/studio-materials/")
    )
      uploads += 1;
  });
  const title = `${runtime.runId} Shakespeare Lexicon attempt-${test.info().retry}`;
  const lexiconBytes = Buffer.from(
    `%PDF-1.4\nDeterministic reusable lexicon fixture attempt-${test.info().retry}\n%%EOF`,
  );
  await page.goto("/coach/materials");
  await page.getByRole("button", { name: "New resource", exact: true }).click();
  const editor = page.getByRole("dialog", {
    name: "Add New Resource",
    exact: true,
  });
  await editor.getByLabel("Title", { exact: true }).fill(title);
  for (const [kind, name] of [
    ["Topics", "Shakespeare"],
    ["Levels", "Beginner"],
    ["Levels", "Advanced"],
    ["Mediums", "PDF"],
  ]) {
    const picker = editor.locator("details").filter({
      has: page.locator("summary").filter({ hasText: new RegExp(`^${kind}`) }),
    });
    if ((await picker.getAttribute("open")) === null)
      await picker.locator("summary").click();
    await picker.getByRole("searchbox").fill(`${runtime.runId} ${name}`);
    await picker.getByRole("button", { name: /\+ Add New/ }).click();
    await expect(picker.locator("summary")).toContainText(name);
    await picker.locator("summary").click();
  }
  await editor.getByLabel("File", { exact: true }).setInputFiles({
    name: `${runtime.runId}-lexicon.pdf`,
    mimeType: "application/pdf",
    buffer: lexiconBytes,
  });
  await expectNoSeriousAxeViolations(page, '[role="dialog"]');
  await editor
    .getByRole("button", { name: "Add resource", exact: true })
    .click();
  await expect(editor).toBeHidden();
  await page.getByRole("searchbox", { name: "Search resources" }).fill(title);
  const row = page
    .locator(".resource-results article")
    .filter({ has: page.getByText(title, { exact: true }) });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Assign", exact: true }).click();
  const assign = page.getByRole("dialog", { name: "Assign resource" });
  await assign
    .getByRole("searchbox", { name: "Find students to assign" })
    .fill(runtime.runId);
  await assign.getByLabel(`${runtime.runId} Student`, { exact: true }).check();
  await assign
    .getByLabel(`${runtime.runId} Coach Account`, { exact: true })
    .check();
  await assign
    .getByLabel("Student-facing instructions")
    .fill("Read the shared glossary.\nBring questions to the next lesson.");
  await assign
    .getByLabel("Private coach notes")
    .fill("Private assessment; never student-visible.");
  await assign.getByRole("button", { name: "Assign to 2 students" }).click();
  await expect(assign).toBeHidden();
  expect(uploads).toBe(1);
  const student = await openAs(browser, "student");
  await student.page.goto("/portal/materials");
  const studentRow = student.page
    .locator(".resource-results article")
    .filter({ has: student.page.getByText(title, { exact: true }) });
  await expect(studentRow).toBeVisible();
  await studentRow.getByRole("button", { name: "Details" }).click();
  await expect(
    studentRow.getByRole("button", { name: "Open file" }),
  ).toBeVisible();
  const filePopup = student.page.waitForEvent("popup");
  const fileRequest = student.context.waitForEvent("request", {
    predicate: (request) =>
      request.method() === "GET" &&
      request.url().includes("/storage/v1/object/sign/studio-materials/") &&
      new URL(request.url()).searchParams.has("token"),
  });
  await studentRow.getByRole("button", { name: "Open file" }).click();
  const filePage = await filePopup;
  const download = await student.context.request.get((await fileRequest).url());
  expect(download.ok()).toBe(true);
  expect(await download.body()).toEqual(lexiconBytes);
  await filePage.close();
  await expect(studentRow).toContainText("Read the shared glossary.");
  await expect(
    student.page.getByText("Private assessment; never student-visible."),
  ).toHaveCount(0);
  await studentRow.getByRole("button", { name: "Vault", exact: true }).click();
  await expect(studentRow).toHaveCount(0);
  await student.page
    .getByLabel("Materials", { exact: true })
    .selectOption("vaulted");
  await expect(studentRow).toBeVisible();
  await studentRow
    .getByRole("button", { name: "Restore", exact: true })
    .click();
  const unrelated = await openAs(browser, "unrelated");
  await unrelated.page.goto("/portal/materials");
  await unrelated.page
    .getByRole("searchbox", { name: "Search resources" })
    .fill(title);
  await expect(
    unrelated.page.getByText("No resources found", { exact: true }),
  ).toBeVisible();
  await expect(unrelated.page.getByText(title, { exact: true })).toHaveCount(0);
  // Reuse through the existing student workflow; no second upload.
  await page.goto(`/coach/students/${runtime.ids?.unrelatedStudent}/work`);
  await page
    .getByRole("button", { name: "Add material", exact: true })
    .first()
    .click();
  const choose = page.getByRole("dialog", {
    name: "Add material",
    exact: true,
  });
  await choose.getByRole("searchbox", { name: "Search resources" }).fill(title);
  await choose
    .getByRole("button", { name: "Choose resource", exact: true })
    .click();
  await choose
    .getByRole("button", { name: "Assign resource", exact: true })
    .click();
  await expect(choose).toBeHidden();
  expect(uploads).toBe(1);
  await unrelated.page.reload();
  await expect(unrelated.page.getByText(title, { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(student.page);
  await student.context.close();
  await unrelated.context.close();
  await coach.context.close();
});
