import { expect, test } from "@playwright/test";
import { ids, installFixture } from "./fixture";

type LessonNoteRecovery = {
  id: string;
  workingNoteId: string;
  baseVersion: number;
  version: number;
  lessonId: string | null;
  title: string;
  body: string;
  bodyHtml: string;
  committed: boolean;
};

test("a private note recovers formatted content after a lost receipt and refresh", async ({
  page,
  context,
}) => {
  const state = await installFixture(context, "coach");
  let checkpoint: LessonNoteRecovery | null = null;
  const writeIds: string[] = [];
  const recoveryId = "70000000-0000-4000-8000-000000000096";
  await context.route("**/rest/v1/rpc/manage_lesson_note_recovery", (route) => {
    const fulfil = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        json: body,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
        },
      });
    if (route.request().method() === "OPTIONS") return fulfil(null);
    const body = route.request().postDataJSON();
    expect(body.p_student_id).toBe(ids.student);
    expect(body.p_note_id).toBeNull();
    if (body.p_action === "read") return fulfil(checkpoint);
    if (body.p_action === "discard") {
      expect(body.p_payload).toEqual({ recoveryId, expectedVersion: 1 });
      checkpoint = null;
      return fulfil(null);
    }
    const value = body.p_payload;
    writeIds.push(value.writeId);
    if (writeIds.length > 1) return fulfil(checkpoint);
    checkpoint = {
      id: recoveryId,
      workingNoteId: value.workingNoteId,
      baseVersion: value.baseVersion,
      version: 1,
      lessonId: value.lessonId,
      title: value.title,
      body: value.body,
      bodyHtml: value.bodyHtml,
      committed: false,
    };
    return fulfil({ message: "Synthetic lost receipt", code: "08006" }, 503);
  });

  await page.goto(`/coach/students/${ids.student}/notes`);
  const open = async () => {
    await page.getByRole("button", { name: "New note", exact: true }).click();
    const composer = page.getByRole("dialog", { name: "New note" });
    await expect(
      composer.getByRole("textbox", { name: "Title" }),
    ).toBeEditable();
    return composer;
  };
  let composer = await open();
  const marker = "Synthetic rehearsal strategy";
  await composer
    .getByRole("textbox", { name: "Title" })
    .fill("Recovery fixture");
  const editor = composer.getByRole("textbox", { name: "Note", exact: true });
  await editor.fill(marker);
  await editor.press("ControlOrMeta+a");
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString().trim()))
    .toBe(marker);
  await composer.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(composer.getByRole("alert")).toContainText("did not confirm");
  await expect(composer.getByRole("status")).not.toHaveText(
    "Private recovery copy saved",
  );
  await composer.getByRole("button", { name: "Retry recovery save" }).click();
  await expect(composer.getByRole("status")).toHaveText(
    "Private recovery copy saved",
  );
  expect(writeIds).toHaveLength(2);
  expect(writeIds[0]).toBe(writeIds[1]);
  expect(state.commands).not.toContain("create");

  await page.reload();
  composer = await open();
  await expect(composer.getByRole("status")).toHaveText(
    "Private draft recovered",
  );
  await expect(composer.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Recovery fixture",
  );
  await expect(
    composer.locator("[contenteditable] b, [contenteditable] strong"),
  ).toContainText(marker);
  await expect
    .poll(() =>
      page.evaluate(
        (text) => !JSON.stringify(localStorage).includes(text),
        marker,
      ),
    )
    .toBe(true);
  page.once("dialog", (dialog) => void dialog.accept());
  await composer.getByRole("button", { name: "Discard private edits" }).click();
  await expect(composer.getByRole("status")).toHaveText("New private draft");
  await expect(
    composer.getByRole("textbox", { name: "Note", exact: true }),
  ).toBeEmpty();
  expect(checkpoint).toBeNull();
});

test("saving a working revision of a published note stays private until explicit review and publish", async ({
  page,
  context,
}) => {
  const state = await installFixture(context, "coach");
  const noteId = "70000000-0000-4000-8000-000000000095";
  const recoveryId = "70000000-0000-4000-8000-000000000096";
  const oldBody = "Previously published feedback";
  const newBody = "Approved revision text";
  const publishedNote = {
    id: noteId,
    student_id: ids.student,
    lesson_id: ids.lesson,
    title: "Synthetic published note",
    body: oldBody,
    body_html: `<p>${oldBody}</p>`,
    status: "published",
    updated_at: "2026-11-26T18:00:00Z",
    version: 1,
  };
  state.notes.push(publishedNote);
  let checkpoint: LessonNoteRecovery | null = null;
  let publishCount = 0;
  await context.route("**/rest/v1/rpc/manage_lesson_note_recovery", (route) => {
    const reply = (json: unknown) =>
      route.fulfill({
        json,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "*",
        },
      });
    if (route.request().method() === "OPTIONS") return reply(null);
    const body = route.request().postDataJSON();
    expect(body.p_note_id).toBe(noteId);
    if (body.p_action === "read") return reply(checkpoint);
    if (body.p_action === "discard") {
      expect(body.p_payload).toEqual({ recoveryId, expectedVersion: 1 });
      checkpoint = null;
      return reply(null);
    }
    const value = body.p_payload;
    expect(value.baseVersion).toBe(1);
    checkpoint = {
      id: recoveryId,
      workingNoteId: noteId,
      baseVersion: value.baseVersion,
      version: 1,
      lessonId: value.lessonId,
      title: value.title,
      body: value.body,
      bodyHtml: value.bodyHtml,
      committed: false,
    };
    return reply(checkpoint);
  });
  await page.route("**/api/v2/notes", (route) => {
    const command = route.request().postDataJSON();
    expect(command.command).toBe("update");
    expect(command.entityId).toBe(noteId);
    expect(command.expectedVersion).toBe(1);
    expect(command.payload).toMatchObject({
      status: "published",
    });
    expect(command.payload.body).toContain(newBody);
    expect(command.payload.bodyHtml).toMatch(
      /<(b|strong)>Approved revision text<\/(b|strong)>/,
    );
    expect(command.payload.bodyHtml).toContain("<h4>Practice plan</h4>");
    expect(command.payload.bodyHtml).toContain(
      '<ol start="4"><li><p>Rehearse</p><ul>',
    );
    expect(command.payload.bodyHtml).toContain(
      'href="https://example.test/reference"',
    );
    publishCount += 1;
    publishedNote.body = command.payload.body;
    publishedNote.body_html = command.payload.bodyHtml;
    publishedNote.version = 2;
    return route.fulfill({ json: { resource: publishedNote } });
  });
  await page.goto(`/coach/students/${ids.student}/notes?note=${noteId}`);
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Edit note" });
  const editor = composer.getByRole("textbox", { name: "Note", exact: true });
  await expect(composer.getByRole("textbox", { name: "Title" })).toBeEditable();
  await expect(editor).toContainText(oldBody);
  await editor.fill(newBody);
  await editor.press("ControlOrMeta+a");
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString().trim()))
    .toBe(newBody);
  await composer.getByRole("button", { name: "Bold", exact: true }).click();
  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await editor.evaluate((element) => {
    const content = new DataTransfer();
    content.setData("text/plain", "Practice plan\nRehearse\nReference notes");
    content.setData(
      "text/html",
      '<h4>Practice plan</h4><ol start="4"><li>Rehearse<ul><li><a href="https://example.test/reference"><em><u>Reference notes</u></em></a></li></ul></li></ol>',
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: content,
      }),
    );
  });
  await expect(editor.locator("ol ul a")).toHaveText("Reference notes");
  await composer.getByRole("button", { name: "Save draft" }).click();
  await expect(composer.getByRole("status")).toHaveText(
    "Private recovery copy saved",
  );
  expect(publishCount).toBe(0);
  expect(publishedNote.body).toBe(oldBody);

  await page.reload();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(composer.getByRole("status")).toHaveText(
    "Private draft recovered",
  );
  await expect(editor.locator("h4")).toHaveText("Practice plan");
  await expect(editor.locator('ol[start="4"] ul a u')).toHaveText(
    "Reference notes",
  );

  await composer.getByRole("button", { name: "Review publication" }).click();
  await expect(
    composer.getByRole("heading", { name: "Review publication" }),
  ).toBeVisible();
  await expect(
    composer
      .locator(".published-note-body ol ul a, .rich-editor-body ol ul a")
      .filter({ visible: true }),
  ).toHaveText("Reference notes");
  expect(publishCount).toBe(0);
  expect(publishedNote.body).toBe(oldBody);
  await composer.getByRole("button", { name: "Publish changes" }).click();
  await expect(composer.getByRole("status")).toHaveText("Published to student");
  expect(publishCount).toBe(1);
  expect(publishedNote.body).toContain(newBody);
  expect(checkpoint).toBeNull();
});
