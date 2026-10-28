import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installFixture } from "../candidate-local/fixture";
import { discoveryFixture, sourceNames } from "./fixture";
for (const width of [320, 390, 768, 1440])
  test(`selected-calendar preview and recovery at ${width}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const app = await installFixture(context, "coach"),
      state = await discoveryFixture(context);
    await page.goto("/coach/settings?panel=integrations");
    const opener = page.getByRole("button", {
      name: "Calendar discovery previews",
      exact: true,
    });
    await opener.focus();
    await page.keyboard.press("Enter");
    let dialog = page.getByRole("dialog", {
      name: "Preview Calendar events",
      exact: true,
    });
    expect(state.pages).toHaveLength(0);
    await dialog.getByLabel("From", { exact: true }).fill("2020-01-01T09:00");
    await dialog.getByLabel("Until", { exact: true }).fill("2020-02-01T09:00");
    await dialog
      .getByRole("button", { name: "Load accessible calendars", exact: true })
      .click();
    await dialog.getByRole("checkbox", { name: /Studio Calendar/ }).check();
    await dialog
      .getByRole("button", { name: "Load more calendars", exact: true })
      .click();
    await dialog.getByRole("checkbox", { name: /Historical Calendar/ }).check();
    await dialog
      .getByRole("button", { name: "Save preview request", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("alert")).toContainText(
      "Synthetic lost start response",
    );
    await expect(dialog.getByLabel("From", { exact: true })).toHaveValue(
      "2020-01-01T09:00",
    );
    await expect(
      dialog.getByRole("checkbox", { name: /Historical Calendar/ }),
    ).toBeChecked();
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    const createAxe = await new AxeBuilder({ page })
      .include(".calendar-discovery-dialog")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      createAxe.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([]);
    await dialog.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({
      path: info.outputPath(`discovery-create-${width}.png`),
      fullPage: false,
    });
    await dialog
      .getByRole("button", { name: "Save preview request", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    dialog = page.getByRole("dialog", {
      name: "Calendar preview progress",
      exact: true,
    });
    await expect(
      dialog.getByRole("heading", { name: "Preview queued", exact: true }),
    ).toBeVisible();
    expect(state.starts).toHaveLength(2);
    expect(state.starts[1]).toEqual(state.starts[0]);
    expect(state.pages).toHaveLength(0);
    await dialog
      .getByRole("button", {
        name: `${sourceNames.alpha}: read next page`,
        exact: true,
      })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Synthetic checkpoint response lost",
    );
    await dialog
      .getByRole("button", {
        name: `${sourceNames.alpha}: recover previous page result`,
        exact: true,
      })
      .click();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    expect(state.pages[1]).toEqual(state.pages[0]);
    await dialog
      .getByRole("button", {
        name: `${sourceNames.beta}: read next page`,
        exact: true,
      })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Preview partial", exact: true }),
    ).toBeVisible();
    await expect(dialog).toContainText("Read access was denied");
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    const partialAxe = await new AxeBuilder({ page })
      .include(".calendar-discovery-dialog")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(partialAxe.violations.map((v) => v.id)).toEqual([]);
    await dialog.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({
      path: info.outputPath(`discovery-partial-${width}.png`),
      fullPage: false,
    });
    await dialog
      .getByRole("button", {
        name: `${sourceNames.beta}: retry saved page`,
        exact: true,
      })
      .click();
    await expect(
      dialog.getByRole("heading", { name: "Preview completed", exact: true }),
    ).toBeVisible();
    expect(state.pages[3]).toEqual(state.pages[2]);
    await dialog
      .getByRole("button", { name: "Load more candidates", exact: true })
      .click();
    await expect(dialog).toContainText("Showing 27 of 27 saved candidates");
    await expect(dialog).toContainText(
      "Previously ignored; it remains ignored",
    );
    await expect(
      dialog.getByRole("link", { name: "Open possibly linked lesson" }),
    ).toHaveAttribute("href", /\/coach\/records\/lesson\//);
    await dialog
      .getByRole("heading", { name: "Source observations", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath(`discovery-observations-${width}.png`),
      fullPage: false,
    });
    await dialog
      .getByRole("button", { name: "Browse saved previews", exact: true })
      .click();
    dialog = page.getByRole("dialog", {
      name: "Saved Calendar previews",
      exact: true,
    });
    await expect(dialog).toContainText("1 saved previews");
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.screenshot({
      path: info.outputPath(`discovery-saved-${width}.png`),
      fullPage: false,
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect(app.pageErrors).toEqual([]);
    await info.attach("fixture-command-evidence", {
      body: JSON.stringify(
        {
          layer: "synthetic HTTP browser",
          starts: state.starts,
          pages: state.pages,
          providerDelivery: "not exercised",
          canonicalEffects: "none in preview",
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });
