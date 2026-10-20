import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { StudioSnapshot } from "../../src/domain/model";

const lessonId = "wave4-lesson",
  resourceId = "e4400000-0000-4000-8000-000000000001";
async function prepare(page: Page) {
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:4176"
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/coach/today");
  const data: StudioSnapshot = await page.evaluate(async () => {
    const path = "/src/data/demo.ts";
    return structuredClone(
      (await import(/* @vite-ignore */ path)).demoSnapshot,
    );
  });
  const baseLesson = data.lessons[0];
  data.lessons = [
    {
      ...baseLesson,
      id: lessonId,
      studentId: "student-maya",
      topic: "Connected coaching",
      startsAt: new Date(Date.now() + 900000).toISOString(),
      endsAt: new Date(Date.now() + 4500000).toISOString(),
      status: "scheduled",
      offeringId: undefined,
      joinUrl: undefined,
    },
  ];
  data.notes = [
    {
      id: "wave4-draft",
      studentId: "student-maya",
      lessonId,
      title: "Coaching feedback",
      body: "Private preparation",
      status: "draft",
      version: 1,
      updatedAt: new Date().toISOString(),
    },
  ];
  data.assignments = [];
  data.materials = [
    {
      id: "wave4-link",
      resourceId,
      studentId: "student-maya",
      lessonId,
      role: "lesson_material",
      title: "Canonical rehearsal text",
      category: "Scene study",
      status: "active",
      approvalStatus: "not_public",
      textContent: "Read for intention.",
      instructions: "Prepare two contrasting choices.",
      version: 1,
      updatedAt: new Date().toISOString(),
    },
  ];
  const sarah = data.students.find((s) => s.id === "student-sarah")!;
  data.students.push({
    ...sarah,
    id: "student-second-child",
    fullName: "Second Child",
    preferredName: "Second Child",
  });
  data.notes.push({
    ...data.notes[0],
    id: "second-feedback",
    studentId: "student-second-child",
    title: "Second child feedback",
    status: "published",
  });
  await page.evaluate((snapshot) => {
    localStorage.setItem(
      "stage-story-studio-core-v2",
      JSON.stringify(snapshot),
    );
  }, data);
}
async function checkView(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact || ""),
    ),
  ).toEqual([]);
}

test("prepare, reuse draft, complete independently, publish, assign and finish practice", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/coach/today");
  await page
    .getByRole("button", { name: "Open lesson workspace", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/lessons/${lessonId}`));
  await page
    .getByRole("button", { name: "Continue draft", exact: true })
    .first()
    .click();
  const editor = page.getByRole("dialog", { name: "Edit note", exact: true });
  await expect(editor.getByRole("combobox").first()).toHaveValue(lessonId);
  await editor
    .getByRole("textbox", { name: "Note", exact: true })
    .fill("Private preparation and a clear next step.");
  await editor
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(editor).toBeHidden();
  let state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("stage-story-studio-core-v2")!),
  );
  expect(
    state.notes.filter(
      (n: { studentId: string }) => n.studentId === "student-maya",
    ),
  ).toHaveLength(1);
  expect(state.notes[0].status).toBe("draft");
  expect(state.lessons[0].status).toBe("scheduled");
  await page
    .getByRole("button", { name: "Complete lesson", exact: true })
    .click();
  await expect(
    page.getByText(
      "Lesson completed. Your notes remain unchanged; share feedback when ready.",
    ),
  ).toBeVisible();
  state = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("stage-story-studio-core-v2")!),
  );
  expect(state.notes[0].status).toBe("draft");
  expect(state.lessons[0].status).toBe("completed");
  await page
    .getByRole("button", { name: "Continue draft", exact: true })
    .first()
    .click();
  await editor.getByRole("checkbox", { name: /Publish to student/ }).check();
  await editor
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(editor).toBeHidden();
  await page
    .getByRole("button", { name: "Assign follow-up", exact: true })
    .click();
  const practice = page.getByRole("dialog", {
    name: "Assign practice",
    exact: true,
  });
  await practice
    .getByLabel("Title", { exact: true })
    .fill("Rehearse the objective");
  await practice
    .getByLabel(/Instructions|Details/)
    .fill("Try the two contrasting choices.");
  await practice
    .getByRole("button", { name: /Assign practice|Assign$/ })
    .click();
  await expect(practice).toBeHidden();
  await page.goto("/portal/work?student=student-maya");
  await expect(
    page.getByText("Coaching feedback", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Rehearse the objective", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Complete & archive", exact: true })
    .click();
  await expect(
    page.getByText("Rehearse the objective", { exact: true }),
  ).toBeHidden();
  await page.goto(`/coach/students/student-maya/lessons/${lessonId}`);
  await expect(
    page.getByText("completed", { exact: true }).first(),
  ).toBeVisible();
  await checkView(page);
});

test("selected guardian child and private drafts stay isolated", async ({
  page,
}) => {
  await prepare(page);
  await page.goto(
    "/e2e/visual-polish/index.html?path=" +
      encodeURIComponent("/portal?student=student-second-child"),
  );
  await expect(
    page.getByText("Second child feedback", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Coaching feedback", { exact: true }),
  ).toBeHidden();
  await page
    .getByRole("navigation", { name: "Portal navigation" })
    .getByRole("link", { name: "Student Work", exact: true })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Portal navigation" })
      .getByRole("link", { name: "Student Work", exact: true }),
  ).toHaveAttribute("href", "/portal/work?student=student-second-child");
  await expect(
    page.getByRole("button", { name: "Complete & archive" }),
  ).toHaveCount(0);
  await checkView(page);
});

test("group lesson actions stay at class scope and forged guardian context is unavailable", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/coach/today");
  await page.evaluate(() => {
    const key = "stage-story-studio-core-v2",
      data = JSON.parse(localStorage.getItem(key)!);
    data.lessons[0].offeringId = "wave4-class";
    data.notes.push({
      ...data.notes[0],
      id: "peer-draft",
      studentId: "student-liam",
      title: "OTHER PARTICIPANT PRIVATE DRAFT",
    });
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.goto(`/coach/students/student-maya/lessons/${lessonId}`);
  await expect(
    page.getByRole("button", { name: "Complete lesson", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Whole-class workspace", exact: true }),
  ).toHaveAttribute("href", "/coach/classes/wave4-class");
  await expect(page.getByText("OTHER PARTICIPANT PRIVATE DRAFT")).toHaveCount(
    0,
  );
  await page.goto(
    "/e2e/visual-polish/index.html?path=" +
      encodeURIComponent("/portal?student=student-maya"),
  );
  await expect(
    page.getByRole("heading", { name: "Record unavailable", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Private preparation")).toHaveCount(0);
});

test("phone, tablet and dark appearance retain visible controls and exact resource context", async ({
  page,
}) => {
  await prepare(page);
  await page.goto("/portal/work?student=student-maya");
  const resource = page
    .locator(".resource-results article")
    .filter({ hasText: "Canonical rehearsal text" });
  await expect(resource).toHaveCount(1);
  await resource.getByRole("button", { name: "Details", exact: true }).click();
  await expect(page).toHaveURL(/assignment=wave4-link/);
  await expect(page).toHaveURL(/student=student-maya/);
  await page.goBack();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/portal/work?student=student-maya");
    await page.getByRole("heading", { name: "My Work", exact: true }).waitFor();
    await checkView(page);
  }
  await page.evaluate(
    () => (document.documentElement.dataset.portalTheme = "dark"),
  );
  // Let the existing surface-color transition settle before measuring contrast.
  await page.waitForTimeout(250);
  await checkView(page);
});

test("next lesson resets payment fields and closes the previous lesson actions", async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    const key = "stage-story-studio-core-v2",
      data = JSON.parse(localStorage.getItem(key)!);
    Object.assign(data.lessons[0], {
      priceMinor: 10000,
      paidMinor: 2500,
      paymentStatus: "partially_paid",
      packageId: undefined,
    });
    data.lessons.push({
      ...data.lessons[0],
      id: "wave4-next",
      topic: "Next coaching lesson",
      startsAt: new Date(Date.now() + 172800000).toISOString(),
      endsAt: new Date(Date.now() + 176400000).toISOString(),
      priceMinor: 20000,
      paidMinor: 0,
      paymentStatus: "due",
    });
    data.creditEntries = [];
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.goto(`/coach/students/student-maya/lessons/${lessonId}`);
  await page
    .getByText("Payment, credits & lesson administration", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Credits & payment", exact: true })
    .click();
  const payment = page.getByRole("dialog", {
    name: "Lesson credits",
    exact: true,
  });
  await expect(
    payment.getByLabel("Lesson price (USD)", { exact: true }),
  ).toHaveValue("100");
  await payment.getByLabel("Lesson price (USD)", { exact: true }).fill("999");
  await payment.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("link", { name: "Next lesson", exact: true }).click();
  await expect(payment).toBeHidden();
  await page
    .getByText("Payment, credits & lesson administration", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Credits & payment", exact: true })
    .click();
  await expect(
    payment.getByLabel("Lesson price (USD)", { exact: true }),
  ).toHaveValue("200");
  await expect(
    payment.getByLabel("Amount paid (USD)", { exact: true }),
  ).toHaveValue("0");
  await expect(payment.getByRole("combobox", { name: /^Status/ })).toHaveValue(
    "due",
  );
});
