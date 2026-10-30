import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ids } from "../candidate-local/fixture";
import { providerIdentityFixture, selectedId } from "./fixture";
for (const width of [320, 390, 768, 1440])
  test(`original provider identity and retry at ${width}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await providerIdentityFixture(context);
    await page.goto("/coach/today");
    const opener = page.getByRole("button", { name: "Verify", exact: true });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Verify imported lesson",
      exact: true,
    });
    const student = dialog.getByRole("combobox", {
      name: "Student",
      exact: true,
    });
    await student.selectOption(selectedId);
    await expect(dialog.getByText(/Only this unlinked signal/)).toBeVisible();
    await expect(dialog.getByRole("checkbox")).toHaveCount(0);
    await expect(
      dialog.getByRole("link", { name: "Open original student profile" }),
    ).toHaveAttribute("href", "/coach/records/student/" + ids.student);
    const links = dialog.getByRole("link", {
      name: "Review duplicate profile links in Students",
    });
    await expect(links).toHaveAttribute("href", "/coach/students");
    await dialog
      .getByRole("link", { name: "Open original student profile" })
      .focus();
    await page.keyboard.press("Tab");
    await expect(links).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("textbox", { name: "Verification note (optional)" }),
    ).toBeFocused();
    await dialog.screenshot({
      path: `docs/audit-provider-identity/evidence/${info.project.name}-${width}-review.png`,
    });
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    const geometry = await dialog.boundingBox();
    expect(geometry!.x).toBeGreaterThanOrEqual(0);
    expect(geometry!.x + geometry!.width).toBeLessThanOrEqual(width + 1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog
      .getByRole("textbox", { name: "Verification note (optional)" })
      .fill("Coach checked original provider identity");
    const confirm = dialog.getByRole("button", {
      name: "Confirm student & lesson",
      exact: true,
    });
    await confirm.click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Synthetic response lost",
    );
    await expect(student).toHaveValue(selectedId);
    expect(
      state.commands[0].payload as Record<string, unknown>,
    ).not.toHaveProperty("mergeStudentId");
    await dialog.screenshot({
      path: `docs/audit-provider-identity/evidence/${info.project.name}-${width}-recovery.png`,
    });
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    expect(state.commands).toHaveLength(2);
    expect(state.commands[1]).toEqual(state.commands[0]);
    state.linked = true;
    state.reviewed = false;
    await page.reload();
    await opener.focus();
    await page.keyboard.press("Enter");
    await student.selectOption(selectedId);
    await expect(
      dialog.getByText(/This lesson keeps its original student/),
    ).toBeVisible();
    await expect(confirm).toBeDisabled();
    await expect(
      dialog.getByRole("switch", { name: /Create an interested student/ }),
    ).toBeDisabled();
    expect(state.commands).toHaveLength(2);
    await dialog.screenshot({
      path: `docs/audit-provider-identity/evidence/${info.project.name}-${width}-linked-hold.png`,
    });
    expect(
      (
        await new AxeBuilder({ page })
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await student.selectOption(ids.student);
    await expect(confirm).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
