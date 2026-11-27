import { expect, test } from "@playwright/test";
import { ids, installFixture } from "./fixture";

test("professional formatting stays semantic and follows the selection", async ({
  page,
  context,
}, testInfo) => {
  await installFixture(context, "coach");
  await context.route("**/rest/v1/rpc/manage_lesson_note_recovery", (route) =>
    route.fulfill({
      json: null,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
      },
    }),
  );
  await page.goto(`/coach/students/${ids.student}/notes`);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "New note" });
  const editor = composer.getByRole("textbox", { name: "Note", exact: true });
  await expect(editor).toBeEditable();
  const format = (name: string) =>
    composer.getByRole("button", { name, exact: true });

  await editor.press("End");
  await page.keyboard.insertText("Listening and intention");
  await format("Heading 2").click();
  await expect(editor.locator("h2")).toHaveText("Listening and intention");
  await expect(format("Heading 2")).toHaveAttribute("aria-pressed", "true");
  await editor.press("Enter");
  await format("Numbered list").click();
  await page.keyboard.insertText("Rehearse the first beat");
  await editor.press("Enter");
  await page.keyboard.insertText("Try a quieter entrance");
  await editor.press("Tab");
  await expect(editor.locator("ol li ol li")).toHaveText(
    "Try a quieter entrance",
  );
  await editor.press("Shift+Tab");
  await expect(editor.locator(":scope > ol > li")).toHaveCount(2);
  await format("Indent list item").click();
  await expect(editor.locator("ol li ol li")).toHaveText(
    "Try a quieter entrance",
  );
  await format("Undo").click();
  await expect(editor.locator(":scope > ol > li")).toHaveCount(2);
  await format("Redo").click();
  await expect(editor.locator("ol li ol li")).toHaveText(
    "Try a quieter entrance",
  );

  await editor.press("ControlOrMeta+End");
  await editor.press("Enter");
  await editor.press("Enter");
  await editor.press("Enter");
  await expect(editor.locator(":scope > p:last-child")).toHaveCount(1);
  await editor.evaluate((element) => {
    const payload = new DataTransfer();
    payload.setData(
      "text/plain",
      "Second pass\nKeep the pause\nReview\nRecord",
    );
    payload.setData(
      "text/html",
      '<h3>Second pass</h3><ol start="7"><li>Keep the pause</li></ol><ul><li>Review<ul><li>Record</li></ul></li></ul>',
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: payload,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(editor.locator("h3")).toHaveText("Second pass");
  await expect(editor.locator("ol[start='7']")).toContainText("Keep the pause");
  await expect(editor.locator("ul li ul li")).toHaveText("Record");
  await editor.getByText("Keep the pause").click();
  await expect(format("Numbered list")).toHaveAttribute("aria-pressed", "true");
  await format("Restart numbering").click();
  await expect(editor.locator("ol[start='7']")).toHaveCount(0);
  await format("Continue numbering").click();
  await expect(editor.locator("ol[start='2']")).toContainText("Keep the pause");
  await composer.screenshot({
    path: testInfo.outputPath("professional-formatting.png"),
  });
});

test("the keyboard viewport keeps the canvas, selection, and private save reachable", async ({
  page,
  context,
}, testInfo) => {
  test.skip(page.viewportSize()!.width > 680, "Mobile viewport only");
  await page.addInitScript(() => {
    class KeyboardViewport extends EventTarget {
      height = innerHeight;
      offsetTop = 0;
      scale = 1;
    }
    Object.defineProperty(window, "visualViewport", {
      value: new KeyboardViewport(),
    });
  });
  await installFixture(context, "coach");
  await context.route("**/rest/v1/rpc/manage_lesson_note_recovery", (route) =>
    route.fulfill({
      json: null,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
      },
    }),
  );
  await page.goto(`/coach/students/${ids.student}/notes`);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "New note" });
  const editor = composer.getByRole("textbox", { name: "Note", exact: true });
  await expect(editor).toBeEditable();
  await composer.screenshot({
    path: testInfo.outputPath("keyboard-closed.png"),
  });
  await editor.press("End");
  for (const paragraph of [
    "Begin with the movement exercise.",
    "Read the second beat aloud and try a new intention.",
    "Review the recording before the next lesson.",
    "Keep the pause.",
  ]) {
    if (!paragraph.startsWith("Begin")) await editor.press("Enter");
    await page.keyboard.insertText(paragraph);
  }
  await editor.press("Shift+Home");
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe("Keep the pause.");
  const resize = (height: number, offsetTop: number) =>
    page.evaluate(
      ({ height, offsetTop }) => {
        Object.assign(visualViewport!, { height, offsetTop });
        visualViewport!.dispatchEvent(new Event("resize"));
      },
      { height, offsetTop },
    );
  await resize(360, 12);
  await expect(composer).toHaveAttribute("data-keyboard", "true");
  await expect(
    composer.getByRole("button", { name: "Save draft" }),
  ).toBeInViewport();
  await expect(
    composer.getByRole("button", { name: "Review publication" }),
  ).toBeHidden();
  await expect(composer.getByText("Related lesson")).toBeHidden();
  await expect
    .poll(() =>
      editor.evaluate((element) => {
        const selection = getSelection();
        if (!selection?.focusNode || !element.contains(selection.focusNode))
          return false;
        const caret = document.createRange();
        caret.setStart(selection.focusNode, selection.focusOffset);
        caret.collapse(true);
        const rectangle = caret.getBoundingClientRect();
        const canvas = element
          .closest(".lesson-note-main")!
          .getBoundingClientRect();
        return (
          rectangle.height > 0 &&
          rectangle.top >= canvas.top &&
          rectangle.bottom <= canvas.bottom
        );
      }),
    )
    .toBe(true);
  await composer.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(editor.locator("strong")).toHaveText("Keep the pause.");
  await expect(editor).toBeFocused();
  await composer.screenshot({ path: testInfo.outputPath("keyboard-open.png") });
  await resize(page.viewportSize()!.height, 0);
  await expect(composer).toHaveAttribute("data-keyboard", "false");
  await expect(
    composer.getByRole("button", { name: "Review publication" }),
  ).toBeVisible();
  await expect(editor).toContainText("Keep the pause.");
});
