import { expect, test } from "@playwright/test";
import { ids, installFixture } from "./fixture";

test("coach saves and reopens a lesson draft without confirming credit coverage", async ({
  page,
  context,
}, info) => {
  await installFixture(context, "coach");
  let saved:
    | {
        id: string;
        version: number;
        details: unknown;
        confirmed_lesson_id: null;
      }
    | undefined;
  await context.route(
    "**/rest/v1/rpc/household_credit_access",
    async (route) => {
      const input = route.request().postDataJSON();
      expect(input.p_student).toBe(ids.student);
      if (input.p_action === "manual_draft_list")
        return route.fulfill({ json: saved ? [saved] : [] });
      expect(input.p_action).toBe("manual_draft_save");
      saved = {
        id: input.p_value.draftId,
        version: 1,
        details: input.p_value.details,
        confirmed_lesson_id: null,
      };
      await route.fulfill({ json: saved });
    },
  );
  async function openEditor() {
    const addLesson = page.getByRole("button", {
      name: "Add lesson",
      exact: true,
    });
    const addMenu = page.locator("summary").filter({ hasText: /^Add$/ });
    await expect(addLesson.or(addMenu).first()).toBeVisible();
    if (!(await addLesson.isVisible())) await addMenu.click();
    await addLesson.click();
  }
  await page.goto("/coach/students/" + ids.student + "/lessons");
  await openEditor();
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Schedule a lesson" }) });
  await expect(
    dialog.getByRole("button", { name: "Confirm lesson" }),
  ).toBeDisabled();
  await dialog
    .getByRole("textbox", { name: "Reason" })
    .fill("Synthetic lesson draft");
  await dialog.getByRole("button", { name: "Save draft" }).click();
  await expect(dialog.getByText("Draft saved.")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await openEditor();
  await dialog
    .getByRole("combobox", { name: "Saved drafts" })
    .selectOption(saved!.id);
  await expect(dialog.getByRole("textbox", { name: "Reason" })).toHaveValue(
    "Synthetic lesson draft",
  );
  await expect(
    dialog.getByRole("button", { name: "Confirm lesson" }),
  ).toBeDisabled();
  await page.screenshot({ path: info.outputPath("manual-lesson-draft.png") });
});
