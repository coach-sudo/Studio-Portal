import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installFixture, ids } from "../candidate-local/fixture";
import { discoveryFixture } from "./fixture";
import { historicalFixture } from "./historical-fixture";
for (const width of [320, 390, 768, 1440])
  test(`historical source decisions and unchanged recovery at ${width}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await installFixture(context, "coach");
    const discovery = await discoveryFixture(context);
    discovery.alphaSaved = true;
    const state = await historicalFixture(context);
    await page.goto("/coach/settings?panel=integrations");
    const opener = page.getByRole("button", {
      name: "Saved Calendar previews",
      exact: true,
    });
    await opener.focus();
    await page.keyboard.press("Enter");
    let dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "Open preview", exact: true })
      .click();
    await dialog
      .getByRole("button", {
        name: "Review source: Date-only coaching evidence",
        exact: true,
      })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Review Calendar source",
      exact: true,
    });
    await expect(
      dialog.getByRole("combobox", { name: "Review action", exact: true }),
    ).toBeVisible();
    expect(state.requests).toHaveLength(0);
    await dialog
      .getByRole("combobox", { name: "Review action", exact: true })
      .selectOption("reopen");
    await dialog
      .getByRole("combobox", { name: "Source decision to reopen", exact: true })
      .selectOption({ index: 1 });
    await dialog.getByLabel(/I verified this exact legacy event/).check();
    await dialog
      .getByLabel("Reason for this source decision", { exact: true })
      .fill("Coach verified this exact historical source.");
    await dialog
      .getByRole("button", { name: "Preview source decision", exact: true })
      .click();
    await expect(
      dialog.getByRole("region", { name: "Source decision preview" }),
    ).toBeVisible();
    expect(state.requests).toHaveLength(0);
    await dialog
      .getByRole("button", { name: "Confirm source decision", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      dialog.getByText("Source decision saved.", { exact: true }),
    ).toBeVisible();
    expect(state.logicalWrites).toBe(1);
    for (const action of ["skip", "not_lesson", "reopen"]) {
      await dialog
        .getByRole("combobox", { name: "Review action", exact: true })
        .selectOption(action);
      await dialog
        .getByRole("button", { name: "Preview source decision", exact: true })
        .click();
      await dialog
        .getByRole("button", { name: "Confirm source decision", exact: true })
        .click();
      await expect(
        dialog.getByText("Source decision saved.", { exact: true }),
      ).toBeVisible();
    }
    await dialog
      .getByRole("combobox", { name: "Review action", exact: true })
      .selectOption("create");
    await dialog
      .getByLabel("Find original student", { exact: true })
      .fill("Original");
    await dialog
      .getByRole("button", { name: "Search original students", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Original student record", exact: true })
      .click();
    await expect(
      dialog.getByRole("link", {
        name: "Original student record",
        exact: true,
      }),
    ).toHaveAttribute("href", "/coach/records/student/" + ids.student);
    await dialog.getByLabel("From", { exact: true }).fill("2025-11-02T01:30");
    await dialog.getByLabel("Until", { exact: true }).fill("2025-11-02T02:30");
    await dialog
      .getByRole("combobox", {
        name: "From repeated-hour occurrence",
        exact: true,
      })
      .selectOption("2025-11-02T06:30:00.000Z");
    await dialog
      .getByLabel("Confirmed location or meeting description", { exact: true })
      .fill("Original historical studio");
    await dialog.getByLabel(/I reviewed any cancellation/).check();
    await dialog
      .getByRole("button", { name: "Preview source decision", exact: true })
      .click();
    await expect(
      dialog.getByRole("region", { name: "Source decision preview" }),
    ).toContainText("Recorded outcome: scheduled");
    expect(state.logicalWrites).toBe(4);
    await dialog.screenshot({
      path: info.outputPath(`historical-preview-${width}.png`),
    });
    await dialog
      .getByRole("button", { name: "Confirm source decision", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Synthetic committed response lost",
    );
    const original = structuredClone(state.requests.at(-1));
    expect(state.logicalWrites).toBe(5);
    await expect(
      dialog.getByRole("combobox", { name: "Review action", exact: true }),
    ).toBeDisabled();
    await dialog.screenshot({
      path: info.outputPath(`historical-unknown-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
    await page
      .getByRole("button", { name: "Calendar discovery previews", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Review Calendar source",
      exact: true,
    });
    await expect(
      dialog.getByLabel("Confirmed location or meeting description", {
        exact: true,
      }),
    ).toHaveValue("Original historical studio");
    await dialog
      .getByRole("button", {
        name: "Recover unchanged source request",
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText("Source decision saved.", { exact: true }),
    ).toBeVisible();
    expect(state.requests.at(-1)).toEqual(original);
    expect(state.logicalWrites).toBe(5);
    await expect(
      dialog.getByText(
        /A scheduled historical lesson and confirmed participant/,
      ),
    ).toBeVisible();
    await expect(dialog.locator("option[value=not_lesson]")).toHaveAttribute(
      "disabled",
      "",
    );
    await expect(dialog.locator("option[value=skip]")).toHaveAttribute(
      "disabled",
      "",
    );
    await dialog
      .getByRole("button", {
        name: "Load source decision history",
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText("Showing 25 of 26 decisions.", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Load older source decisions", exact: true })
      .click();
    await expect(
      dialog.getByText("Showing 26 of 26 decisions.", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Back to source observations", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Calendar preview progress",
      exact: true,
    });
    await dialog
      .getByRole("button", {
        name: "Review source: Cancelled recurring source",
        exact: true,
      })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Review Calendar source",
      exact: true,
    });
    await dialog
      .getByRole("combobox", { name: "Review action", exact: true })
      .selectOption("reopen");
    await dialog
      .getByRole("combobox", { name: "Source decision to reopen", exact: true })
      .selectOption({ index: 1 });
    await dialog.getByLabel(/I verified this exact legacy event/).check();
    await dialog
      .getByLabel("Reason for this source decision", { exact: true })
      .fill("Coach verified original completed lesson source.");
    await dialog
      .getByRole("button", { name: "Preview source decision", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Confirm source decision", exact: true })
      .click();
    await expect(
      dialog.getByText("Source decision saved.", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("combobox", { name: "Review action", exact: true })
      .selectOption("link");
    await dialog
      .getByLabel("Find original student", { exact: true })
      .fill("Original");
    await dialog
      .getByRole("button", { name: "Search original students", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Original student record", exact: true })
      .click();
    await dialog
      .getByLabel("Find existing lesson", { exact: true })
      .fill("Original");
    await dialog
      .getByRole("button", {
        name: "Search this student's lessons",
        exact: true,
      })
      .click();
    await dialog
      .getByRole("button", {
        name: "Original paid completed lesson",
        exact: true,
      })
      .click();
    await dialog.getByLabel(/I reviewed any cancellation/).check();
    await dialog
      .getByRole("button", { name: "Preview source decision", exact: true })
      .click();
    await expect(
      dialog.getByRole("region", { name: "Source decision preview" }),
    ).toContainText("Recorded outcome: completed");
    const violations = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(violations.violations).toEqual([]);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await dialog.screenshot({
      path: info.outputPath(`historical-link-${width}.png`),
    });
    await dialog
      .getByRole("button", { name: "Confirm source decision", exact: true })
      .click();
    await expect(
      dialog.getByText(
        /recorded outcome \(completed\) and financial history were preserved/,
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole("link", {
        name: "Open saved original lesson",
        exact: true,
      }),
    ).toHaveAttribute("href", "/coach/records/lesson/" + ids.lesson);
    expect(
      state.requests
        .filter((r) => r.command === "historical_calendar_reconciliation")
        .every((r) => r.payload.proposal.studentId === ids.student),
    ).toBe(true);
  });
