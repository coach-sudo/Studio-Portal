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

test("professional notes keep formatting and actions available on tablet and phone", async ({
  page,
}, info) => {
  await prepare(page);
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/coach/students/student-maya/lessons/${lessonId}`);
    await page
      .getByRole("button", { name: "Continue draft", exact: true })
      .first()
      .click();
    const editor = page.getByRole("dialog", { name: "Edit note", exact: true });
    const field = editor.getByRole("textbox", { name: "Note", exact: true });
    if (width === 768) {
      await field.fill("Objectives and tactics");
      await field.press("ControlOrMeta+a");
      await expect
        .poll(() => page.evaluate(() => getSelection()?.toString().trim()))
        .toBe("Objectives and tactics");
      await editor.getByRole("button", { name: "Bold", exact: true }).click();
      await expect(field.locator("b, strong")).toHaveText(
        "Objectives and tactics",
      );
      await editor.getByRole("button", { name: "Link", exact: true }).click();
      await editor
        .getByLabel("Web address", { exact: true })
        .fill("https://example.test/rehearsal");
      await editor
        .getByRole("button", { name: "Insert link", exact: true })
        .click();
      await expect(field.locator("a")).toHaveAttribute(
        "href",
        "https://example.test/rehearsal",
      );
      await editor
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      await expect(editor.getByRole("status")).toHaveText(
        "Private draft saved",
      );
    }
    await expect(field.locator("b, strong")).toHaveText(
      "Objectives and tactics",
    );
    await expect(field.locator("a")).toHaveAttribute(
      "href",
      "https://example.test/rehearsal",
    );
    if (width < 500) {
      await editor.getByRole("button", { name: "Expand", exact: true }).click();
      const expanded = page.getByRole("dialog", { name: "Expanded editor" });
      await expect(
        expanded.getByRole("button", { name: "Review publication" }),
      ).toBeInViewport();
      expect((await expanded.boundingBox())?.width).toBe(width);
      await page.screenshot({
        path: info.outputPath("professional-mobile.png"),
      });
      await page.setViewportSize({ width, height: 490 });
      await expect(
        expanded.getByRole("button", { name: "Review publication" }),
      ).toBeInViewport();
      await expanded
        .getByRole("button", { name: "Close", exact: true })
        .click();
    } else {
      await page.screenshot({
        path: info.outputPath("professional-tablet.png"),
      });
      await editor.getByRole("button", { name: "Close", exact: true }).click();
    }
  }
});

test("prepare, reuse draft, complete independently, publish, assign and finish practice", async ({
  page,
}, info) => {
  await prepare(page);
  await page.evaluate(() => {
    const key = "stage-story-studio-core-v2";
    const snapshot = JSON.parse(localStorage.getItem(key)!);
    snapshot.materials[0].inLibrary = true;
    localStorage.setItem(key, JSON.stringify(snapshot));
  });
  await page.setViewportSize({ width: 1440, height: 980 });
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
  await expect(
    editor.getByText("Connected coaching", { exact: true }),
  ).toBeVisible();
  await editor
    .getByRole("textbox", { name: "Note", exact: true })
    .fill("Private preparation and a clear next step.");
  await expect(editor.getByRole("status")).toHaveText("Unsaved changes");
  await page.screenshot({
    path: info.outputPath("professional-desktop.png"),
    animations: "disabled",
  });
  await page.evaluate(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "stage-story-studio-core-v2") {
        Storage.prototype.setItem = write;
        throw new DOMException(
          "Synthetic interrupted save.",
          "QuotaExceededError",
        );
      }
      return write.call(this, key, value);
    };
  });
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("Retry to recover");
  await expect(
    editor.getByRole("textbox", { name: "Note", exact: true }),
  ).toHaveText("Private preparation and a clear next step.");
  await page.screenshot({
    path: info.outputPath("professional-retry.png"),
    animations: "disabled",
  });
  await editor.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(editor.getByRole("status")).toHaveText("Private draft saved");
  await page.screenshot({ path: info.outputPath("professional-saved.png") });
  await editor
    .getByRole("button", { name: "Attach resource", exact: true })
    .click();
  const attachments = page.getByRole("dialog", { name: "Attach Resource" });
  await attachments
    .getByRole("button", { name: "Choose from Library", exact: true })
    .click();
  await expect(
    attachments.getByRole("button", { name: "Add New Resource", exact: true }),
  ).toBeVisible();
  await expect(
    attachments.getByText("Canonical rehearsal text", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("resource-library-selection.png"),
    animations: "disabled",
  });
  await attachments.getByRole("button", { name: "Close", exact: true }).click();
  await editor.getByRole("button", { name: "Close", exact: true }).click();
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
  await editor
    .getByRole("button", { name: "Review publication", exact: true })
    .click();
  await expect(
    editor.getByRole("heading", { name: "Review publication" }),
  ).toBeVisible();
  await expect(
    editor
      .getByRole("region", { name: "Review publication" })
      .getByText("Private preparation and a clear next step."),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("publication-review.png") });
  await editor
    .getByRole("button", { name: "Publish note", exact: true })
    .click();
  await expect(editor.getByRole("status")).toHaveText("Published to student");
  await editor.getByRole("button", { name: "Close", exact: true }).click();
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
    .getByRole("combobox", { name: /Activity/ })
    .selectOption("journal");
  await practice
    .getByRole("button", { name: /Assign practice|Assign$/ })
    .click();
  await expect(practice).toBeHidden();
  await page.goto("/portal/work?student=student-maya");
  await page.getByRole("link", { name: "Lesson notes", exact: true }).click();
  await page.getByRole("button", { name: /Coaching feedback/ }).click();
  await expect(
    page.getByRole("dialog").getByText("Coaching feedback", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Homework", exact: true }).click();
  await expect(
    page.getByText("Rehearse the objective", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Use formatting", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Your reflection", exact: true })
    .fill("I chose to listen before responding.");
  await page
    .getByRole("button", { name: "Save progress", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Complete & archive", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: info.outputPath("assignment-response.png"),
    animations: "disabled",
  });
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

test("actor biography saves as a draft after returning from phone preview", async ({
  page,
}, info) => {
  await prepare(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/portal/actor-page?student=student-maya");
  const edit = page.getByRole("button", { name: "Edit", exact: true });
  await edit.click();
  const editor = page.getByRole("dialog", { name: "Build actor page" });
  const biography = editor.getByRole("textbox", { name: "Bio", exact: true });
  const draft = "Synthetic biography about character work and rehearsal.";
  await biography.fill(draft);
  await editor
    .getByRole("button", { name: "Preview page", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "Edit content", exact: true })
    .click();
  await expect(biography).toHaveValue(draft);
  await biography.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("actor-biography.png"),
    animations: "disabled",
  });
  await editor.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(editor).toBeHidden();
  await edit.click();
  await expect(biography).toHaveValue(draft);
  const actor = await page.evaluate(() => {
    const snapshot = JSON.parse(
      localStorage.getItem("stage-story-studio-core-v2")!,
    );
    return snapshot.actorProfiles.find(
      (item: { studentId: string }) => item.studentId === "student-maya",
    );
  });
  expect(actor.draftStatus).toBe("draft");
  expect(actor.status).toBe("draft");
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
  await page.goto("/portal/materials?student=student-maya");
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

test("next lesson updates payment links and closes the previous lesson actions", async ({
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
      serviceId: "service-private-60",
      sourceProvider: "studio",
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
    payment.getByRole("link", { name: "Email payment link" }),
  ).toHaveAttribute("href", new RegExp("lesson=" + lessonId + "$"));
  await expect(
    payment.getByRole("button", { name: "Send invoice", exact: true }),
  ).toHaveCount(0);
  await payment.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("link", { name: "Next lesson", exact: true }).click();
  await expect(page).toHaveURL(/\/lessons\/wave4-next$/);
  await expect(
    page.getByRole("heading", { name: "Next coaching lesson", exact: true }),
  ).toBeVisible();
  await expect(payment).toBeHidden();

  const administration = page.locator("details.lesson-admin-disclosure");
  await expect(administration).toHaveJSProperty("open", false);
  await administration.locator("summary").click();
  await expect(administration).toHaveJSProperty("open", true);
  await administration
    .getByRole("button", { name: "Credits & payment", exact: true })
    .click();
  await expect(
    payment.getByRole("link", { name: "Email payment link" }),
  ).toHaveAttribute("href", /lesson=wave4-next$/);
  await payment
    .getByRole("button", { name: "Send invoice", exact: true })
    .click();
  const composer = page.getByRole("dialog", {
    name: "Create invoice",
    exact: true,
  });
  await expect(
    composer.getByRole("checkbox", { name: /Next coaching lesson/ }),
  ).toBeChecked();
  await expect(composer.locator(".lesson-invoice-total")).toHaveText("$200.00");
  await composer.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(payment).toBeVisible();
});

test("My Work keeps homework, notes and scripts apart from uploaded lesson files", async ({
  page,
}, info) => {
  const scriptInputWarnings: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /controlled input/.test(message.text()))
      scriptInputWarnings.push(message.text());
  });
  await prepare(page);
  await page.goto(`/coach/students/student-maya/lessons/${lessonId}`);
  await page.getByRole("button", { name: "Attach files", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Attach files to lesson" });
  await drawer.getByLabel("Choose files").setInputFiles([
    {
      name: "Rehearsal.docx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("Document fixture"),
    },
    {
      name: "Performance.mov",
      mimeType: "video/quicktime",
      buffer: Buffer.from("Media fixture"),
    },
  ]);
  await page.screenshot({
    path: info.outputPath("lesson-file-selection.png"),
    animations: "disabled",
  });
  await drawer
    .getByRole("button", { name: "Attach files", exact: true })
    .click();
  await expect(drawer.getByRole("status")).toHaveText("2 of 2 files attached.");
  await drawer.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByText("Rehearsal.docx", { exact: true })).toBeVisible();
  await page.goto("/portal/work?student=student-maya");
  await expect(
    page.getByRole("heading", { name: "Active assignments" }),
  ).toBeVisible();
  await expect(page.getByText("Rehearsal.docx", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("link", { name: "Lesson notes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Published lesson notes" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Scripts", exact: true }).click();
  await page.getByRole("button", { name: "Add script" }).click();
  await page
    .getByRole("combobox", { name: "Source", exact: true })
    .selectOption("link");
  await page.getByLabel("Script link").fill("https://example.test/current");
  await page
    .getByRole("combobox", { name: "Source", exact: true })
    .selectOption("file");
  await expect(page.getByLabel("Script file")).toBeVisible();
  await page
    .getByRole("combobox", { name: "Source", exact: true })
    .selectOption("link");
  await expect(page.getByLabel("Script link")).toHaveValue(
    "https://example.test/current",
  );
  await page
    .getByLabel("Title", { exact: true })
    .fill("First rehearsal script");
  await page.getByRole("button", { name: "Save current script" }).click();
  await page.getByRole("button", { name: "Update script" }).click();
  await page
    .getByRole("combobox", { name: "Source", exact: true })
    .selectOption("link");
  await page.getByLabel("Script link").fill("https://example.test/revision");
  await page
    .getByLabel("Title", { exact: true })
    .fill("Revised rehearsal script");
  await page.getByRole("button", { name: "Save current script" }).click();
  await expect(
    page.getByText("Revised rehearsal script", { exact: true }),
  ).toBeVisible();
  await page.getByText("Script history", { exact: true }).click();
  await expect(
    page.getByText("First rehearsal script", { exact: true }),
  ).toBeVisible();
  await page.goto("/portal/materials?student=student-maya");
  await expect(
    page.getByText("Performance.mov", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Revised rehearsal script", { exact: true }),
  ).toHaveCount(0);
  expect(scriptInputWarnings).toEqual([]);
});

test("lesson payment email opens the same authorized choices on desktop and phone", async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate((id) => {
    const key = "stage-story-studio-core-v2";
    const data = JSON.parse(localStorage.getItem(key)!);
    const lesson = data.lessons.find((item: { id: string }) => item.id === id);
    lesson.paymentStatus = "due";
    lesson.priceMinor = 8500;
    data.invoices = [
      {
        id: "invoice-my-work",
        student_id: "student-maya",
        studio_id: data.studioId,
        number: "INV-PAY-LESSON",
        status: "open",
        currency: "USD",
        issue_date: "2026-01-01",
        due_date: "2029-01-14",
        introduction: "",
        notes: "",
        footer: "",
        branding: { studioName: "Coach’D" },
        recipient: { name: "Maya" },
        total_minor: 8500,
        paid_minor: 0,
        credit_minor: 0,
        version: 1,
        created_at: new Date().toISOString(),
        items: [
          {
            id: "payment-line",
            description: "Rehearsal",
            lessonIds: [id],
            kind: "service",
            referenceId: "service",
            quantity: 1,
            unitMinor: 8500,
            startsOn: "2028-01-10",
            endsOn: "2028-01-10",
            creditMinor: 0,
            paidMinor: 0,
          },
        ],
      },
    ];
    localStorage.setItem(key, JSON.stringify(data));
  }, lessonId);
  await page.goto(
    `/coach/inbox?email=1&template=lesson_payment&student=student-maya&lesson=${lessonId}`,
  );
  const email = page.getByRole("dialog", { name: "Send email" });
  await expect(email.getByLabel("Template")).toHaveValue("lesson_payment");
  const body = await email.getByLabel("Message").inputValue();
  const link = body.split("\n").find((line) => line.startsWith("http"));
  expect(link).toContain(`student=student-maya&lesson=${lessonId}`);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(link!);
    await expect(
      page.getByRole("heading", { name: "Pay for my lesson" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Compare packages" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Pay invoice", exact: true }).click();
    await expect(
      page
        .getByRole("dialog")
        .getByText("INV-PAY-LESSON", { exact: false })
        .first(),
    ).toBeVisible();
  }
});

test("primary actions and focus retain contrast under pale branding in both portal themes", async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    const key = "stage-story-studio-core-v2";
    const data = JSON.parse(localStorage.getItem(key)!);
    Object.assign(data.settings.branding, {
      primaryColor: "#f6f0ac",
      secondaryColor: "#f9f2bb",
      surfaceColor: "#4e636c",
    });
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.goto("/portal/work?student=student-maya&view=scripts");
  const primary = page.getByRole("button", { name: "Add script", exact: true });
  const contrast = () =>
    primary.evaluate((button) => {
      const context = document.createElement("canvas").getContext("2d")!;
      const channelValues = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)].map(
          (channel) => {
            const value = channel / 255;
            return value <= 0.04045
              ? value / 12.92
              : ((value + 0.055) / 1.055) ** 2.4;
          },
        );
      };
      const luminance = (color: string) => {
        const [red, green, blue] = channelValues(color);
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const style = getComputedStyle(button);
      const text = luminance(style.color);
      const fill = luminance(style.backgroundColor);
      return (Math.max(text, fill) + 0.05) / (Math.min(text, fill) + 0.05);
    });
  await expect.poll(contrast).toBeGreaterThanOrEqual(4.5);
  await primary.hover();
  await expect.poll(contrast).toBeGreaterThanOrEqual(4.5);
  await page.evaluate(() => {
    document.documentElement.dataset.portalTheme = "dark";
  });
  await expect.poll(contrast).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press("Tab");
  await primary.focus();
  await expect(primary).toHaveCSS("outline-color", "rgb(255, 255, 255)");
  await expect(primary).toHaveCSS("outline-style", "solid");
});

async function prepareTrainingInvoices(page: Page) {
  await prepare(page);
  await page.evaluate(() => {
    const key = "stage-story-studio-core-v2";
    const data: StudioSnapshot = JSON.parse(localStorage.getItem(key)!);
    const base = data.lessons[0];
    const invoiceId = "training-invoice";
    data.lessons = Array.from({ length: 6 }, (_, index) => ({
      ...base,
      id: `training-lesson-${index}`,
      sourceProvider: "studio",
      topic: `Rehearsal ${index + 1}`,
      startsAt: new Date(
        Date.parse(base.startsAt) + index * 7 * 86400000,
      ).toISOString(),
      endsAt: new Date(
        Date.parse(base.endsAt) + index * 7 * 86400000,
      ).toISOString(),
      invoiceId,
      paymentStatus: "due",
      priceMinor: 8500,
      paidMinor: 0,
    }));
    data.invoices = [
      {
        id: invoiceId,
        student_id: "student-maya",
        studio_id: data.studioId,
        number: "INV-TRAINING",
        status: "open",
        currency: "USD",
        issue_date: "2026-01-01",
        due_date: "2031-05-15",
        introduction: "",
        notes: "",
        footer: "",
        branding: { studioName: "Coach’D" },
        recipient: { name: "Maya" },
        total_minor: 51000,
        paid_minor: 0,
        credit_minor: 0,
        version: 1,
        created_at: new Date().toISOString(),
        items: data.lessons.map((lesson, index) => ({
          id: `training-line-${index}`,
          description: lesson.topic,
          lessonIds: [lesson.id],
          kind: "service",
          referenceId: "service",
          quantity: 1,
          unitMinor: 8500,
          startsOn: lesson.startsAt.slice(0, 10),
          endsOn: lesson.startsAt.slice(0, 10),
          creditMinor: 0,
          paidMinor: 0,
        })),
      },
    ];
    data.settings.branding = {
      ...data.settings.branding,
      primaryColor: "#f0ebd3",
    };
    localStorage.setItem(key, JSON.stringify(data));
  });
}

test("whole-lesson payment selection stays readable across layouts and themes", async ({
  page,
}, testInfo) => {
  await prepareTrainingInvoices(page);
  for (const [width, layout] of [
    [320, "phone"],
    [768, "tablet"],
    [1440, "desktop"],
  ] as const) {
    await page.setViewportSize({ width, height: 920 });
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((appearance) => {
        const key = "stage-story-studio-core-v2";
        const data: StudioSnapshot = JSON.parse(localStorage.getItem(key)!);
        const maya = data.students.find(
          (student) => student.id === "student-maya",
        )!;
        maya.portalPreferences = { ...maya.portalPreferences, appearance };
        localStorage.setItem(key, JSON.stringify(data));
      }, theme);
      await page.goto("/portal/bookings?student=student-maya");
      await expect(
        page.getByText(
          "Your coach has scheduled 6 confirmed upcoming lessons.",
        ),
      ).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute(
        "data-portal-theme",
        theme,
      );
      await checkView(page);
      await page.screenshot({
        path: testInfo.outputPath(`schedule-${layout}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await page.goto("/portal/payments?pay=lesson&student=student-maya");
      const group = page.getByRole("group", {
        name: "Choose lessons to pay for",
      });
      await expect(group.getByRole("checkbox")).toHaveCount(6);
      await group.getByRole("checkbox", { name: /Rehearsal 2/ }).check();
      await group.getByRole("checkbox", { name: /Rehearsal 5/ }).focus();
      await page.keyboard.press("Space");
      await expect(
        page.getByText("2 lessons selected · $170.00 total"),
      ).toBeVisible();
      await checkView(page);
      await page.screenshot({
        path: testInfo.outputPath(`payment-${layout}-${theme}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await group
        .getByRole("button", { name: "Select all eligible lessons" })
        .click();
      await expect(
        page.getByText("6 lessons selected · $510.00 total"),
      ).toBeVisible();
      if (theme === "light") {
        await page.getByRole("button", { name: "Review payment" }).click();
        const review = page.getByRole("dialog", {
          name: "Review selected lessons",
        });
        await expect(review.getByText("Total $510.00")).toBeVisible();
        await checkView(page);
        await page.screenshot({
          path: testInfo.outputPath(`review-${layout}.png`),
          animations: "disabled",
        });
        await review.getByRole("button", { name: "Back to selection" }).click();
      }
    }
  }
  await page.getByRole("button", { name: "Review payment" }).click();
  const review = page.getByRole("dialog", { name: "Review selected lessons" });
  await expect(review.getByText("Total $510.00")).toBeVisible();
  await review
    .getByRole("button", { name: "Continue to secure checkout" })
    .click();
  await expect(
    page.getByText("Demo mode does not open a payment provider."),
  ).toBeVisible();
  await page.goto(
    "/portal/payments?pay=lesson&student=student-maya&lesson=training-lesson-2",
  );
  await expect(
    page.getByText("1 lesson selected · $85.00 total"),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(1);
});

test("lesson payment preview keeps its scope and offers explicit Pay now for a late lesson", async ({
  page,
}, testInfo) => {
  await prepareTrainingInvoices(page);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/portal/bookings?student=student-maya");
  await page.getByRole("link", { name: "Make Recurring" }).click();
  const options = page.getByRole("group", {
    name: "Lessons to include",
    exact: true,
  });
  await expect(options.getByRole("checkbox")).toHaveCount(6);
  const lead = page.getByRole("spinbutton", {
    name: "Days before each lesson",
  });
  await lead.fill("7");
  await options.getByRole("checkbox").first().focus();
  await page.keyboard.press("Space");
  await options.getByRole("checkbox").nth(2).check();
  const preview = page.getByRole("button", { name: "Preview payment dates" });
  await preview.click();
  await expect(
    page.getByRole("link", { name: /Pay now · \$85/ }),
  ).toHaveAttribute(
    "href",
    "/portal/payments?pay=lesson&student=student-maya&lesson=training-lesson-0",
  );
  await expect(page.getByText(/\$85.00 on /)).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
  await page.screenshot({
    path: testInfo.outputPath("autopay-preview-phone.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.dataset.portalTheme = "dark";
  });
  const accessibility = await new AxeBuilder({ page })
    .include(".training-payment-picker")
    .analyze();
  expect(
    accessibility.violations.filter(
      ({ impact }) => impact === "serious" || impact === "critical",
    ),
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("autopay-preview-phone-dark.png"),
    fullPage: true,
  });
  await page.getByRole("radio", { name: "Future lessons only" }).check();
  await expect(options).toHaveCount(0);
  await preview.click();
  await expect(page.getByText(/New lessons can be evaluated/)).toBeVisible();
  await expect(page.getByRole("link", { name: /Pay now · \$85/ })).toHaveCount(
    0,
  );
});

test("calendar package renewal requires the user to choose a cadence", async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate(() => {
    const key = "stage-story-studio-core-v2";
    const data: StudioSnapshot = JSON.parse(localStorage.getItem(key)!);
    const offers = data.packageDefinitions.filter(
      (row) => row.active && row.directPurchase && row.visibility === "public",
    );
    for (const offer of offers)
      data.packageBillingOptions.push({
        id: `test-weekly-package-${offer.id}`,
        studioId: data.studioId,
        definitionId: offer.id,
        renewalMode: "weekly",
        active: true,
        updatedAt: new Date().toISOString(),
        version: 1,
      });
    localStorage.setItem(key, JSON.stringify(data));
  });
  await page.goto("/portal/payments?student=student-maya");
  await page.getByRole("link", { name: "Make Recurring" }).click();
  await expect(
    page.getByRole("heading", { name: "Recurring packages" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Choose package" }).first().click();
  const dialog = page.getByRole("dialog");
  const checkout = dialog.getByRole("button", {
    name: "Continue to secure checkout",
  });
  const cadence = dialog.getByRole("combobox", { name: "Purchase option" });
  await expect(cadence).toHaveValue("");
  await expect(checkout).toBeDisabled();
  await cadence.selectOption("weekly");
  await expect(
    dialog.getByText(/The first payment is due at checkout/),
  ).toBeVisible();
  await expect(checkout).toBeEnabled();
});

test("a fixed weekly proposal can skip dates without moving lessons or charging for them", async ({
  page,
}) => {
  await prepare(page);
  await page.setViewportSize({ width: 390, height: 920 });
  await page.goto("/book/private-acting-coaching");
  await page.getByRole("button", { name: /^Weekly$/ }).click();
  await page.getByRole("button", { name: "Choose a time" }).click();
  await page.locator(".booking-time-list button").first().click();
  const dates = page.getByRole("group", { name: "Dates to book" });
  const choices = dates.getByRole("checkbox");
  await expect(choices).toHaveCount(6);
  await choices.nth(1).uncheck();
  await choices.nth(4).uncheck();
  await expect(dates.getByText("4 to book · 2 skipped")).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Student name" })
    .fill("Synthetic Schedule");
  await page
    .getByRole("textbox", { name: "Student email" })
    .fill("synthetic-schedule@example.test");
  await page.getByRole("button", { name: "Review payment" }).click();
  await page.getByRole("button", { name: /Pay later/i }).click();
  await expect(
    page.getByText("4 lessons to book · 2 dates skipped"),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: /Terms and Conditions/ }).check();
  await page.getByRole("button", { name: "Confirm booking" }).click();
  const result = await page.evaluate(() => {
    const data: StudioSnapshot = JSON.parse(
      localStorage.getItem("stage-story-studio-core-v2")!,
    );
    const booking = data.bookings.find(
      (item) => item.guestEmail === "synthetic-schedule@example.test",
    )!;
    const ids = data.lessonParticipants
      .filter((item) => item.bookingId === booking.id)
      .map((item) => item.lessonId);
    return {
      count: ids.length,
      total: booking.totalMinor,
      status: booking.paymentStatus,
      dates: data.lessons
        .filter((item) => ids.includes(item.id))
        .map((item) => item.startsAt.slice(0, 10))
        .sort(),
    };
  });
  expect(result).toMatchObject({ count: 4, total: 50000, status: "due" });
  expect(
    result.dates
      .slice(1)
      .map(
        (date, index) =>
          (Date.parse(date) - Date.parse(result.dates[index])) / 86400000,
      ),
  ).toEqual([14, 7, 14]);
});

test("home opens the exact next lesson and schedule keeps payment selection in scope", async ({
  page,
}) => {
  await prepare(page);
  await page.evaluate((id) => {
    const key = "stage-story-studio-core-v2";
    const data: StudioSnapshot = JSON.parse(localStorage.getItem(key)!);
    const next = data.lessons.find((item) => item.id === id)!;
    next.invoiceId = "next-lesson-invoice";
    next.paymentStatus = "due";
    next.priceMinor = 8500;
    const previous = {
      ...next,
      id: "previous-lesson",
      topic: "Previous rehearsal",
      invoiceId: "previous-lesson-invoice",
      startsAt: new Date(Date.now() - 86400000).toISOString(),
      endsAt: new Date(Date.now() - 82800000).toISOString(),
      status: "completed" as const,
    };
    data.lessons.push(previous);
    data.invoices = [next, previous].map((lesson, index) => ({
      id: lesson.invoiceId!,
      student_id: next.studentId,
      studio_id: data.studioId,
      number:
        index === 0
          ? "Upcoming rehearsal invoice"
          : "Historical rehearsal invoice",
      status: "open",
      currency: "USD",
      issue_date: "2026-01-01",
      due_date: "2031-05-15",
      introduction: "",
      notes: "",
      footer: "",
      branding: { studioName: "Coach’D" },
      recipient: { name: "Maya" },
      total_minor: 8500,
      paid_minor: 0,
      credit_minor: 0,
      version: 1,
      created_at: new Date().toISOString(),
      items: [
        {
          id: lesson.id + "-invoice-line",
          description: lesson.topic,
          lessonIds: [lesson.id],
          kind: "service",
          referenceId: "service",
          quantity: 1,
          unitMinor: 8500,
          startsOn: lesson.startsAt.slice(0, 10),
          endsOn: lesson.startsAt.slice(0, 10),
          creditMinor: 0,
          paidMinor: 0,
        },
      ],
    }));
    localStorage.setItem(key, JSON.stringify(data));
  }, lessonId);
  await page.goto("/portal?student=student-maya");
  await page.getByRole("button", { name: "Pay for this lesson" }).click();
  await expect(page).toHaveURL(new RegExp("lesson=" + lessonId));
  await expect(
    page.getByRole("checkbox", { name: /Connected coaching/ }),
  ).toBeChecked();
  await page.goto("/portal/bookings?student=student-maya");
  await page
    .getByRole("link", { name: "Review upcoming lesson payments" })
    .click();
  await expect(page).toHaveURL(/upcoming=1/);
  await expect(
    page.getByRole("checkbox", { name: /Connected coaching/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /Previous rehearsal/ }),
  ).toHaveCount(0);
});

test.describe("portal notification accessibility", () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 860 } });

  test("notification actions stay readable and reachable in either theme", async ({
    page,
  }) => {
    await prepare(page);
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((appearance) => {
        const key = "stage-story-studio-core-v2";
        const data: StudioSnapshot = JSON.parse(localStorage.getItem(key)!);
        const student = data.students.find(
          (item) => item.id === "student-maya",
        )!;
        student.portalPreferences = {
          ...student.portalPreferences,
          appearance,
        };
        localStorage.setItem(key, JSON.stringify(data));
      }, theme);
      await page.goto("/portal/payments?pay=lesson&student=student-maya");
      await expect(page.locator("html")).toHaveAttribute(
        "data-portal-theme",
        theme,
      );
      const skip = page.getByRole("link", { name: "Skip to main content" });
      await expect(skip).toHaveCSS("clip-path", "inset(100%)");
      await skip.focus();
      await expect(skip).toHaveCSS("clip-path", "none");
      await page.keyboard.press("Tab");
      await expect(skip).toHaveCSS("clip-path", "inset(100%)");
      await page.getByRole("button", { name: /unread notifications/ }).tap();
      await expect(
        page.getByRole("region", { name: "Recent activity" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Clear all" }),
      ).toBeVisible();
      const audit = await new AxeBuilder({ page })
        .include(".activity-center")
        .analyze();
      expect(
        audit.violations.filter((issue) =>
          ["serious", "critical"].includes(issue.impact ?? ""),
        ),
      ).toEqual([]);
      await page.getByRole("button", { name: "Close notifications" }).tap();
    }
  });
});
