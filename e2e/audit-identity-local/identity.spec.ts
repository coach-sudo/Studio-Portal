import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";
import { ids } from "../candidate-local/fixture";
import { identityFixture, duplicateId } from "./fixture";
for (const width of [320, 390, 768, 1440])
  test(`profile links, replay and original context at ${width}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await identityFixture(context);
    await page.goto("/coach/students");
    const opener = page.getByRole("button", {
      name: "Link duplicate profiles",
      exact: true,
    });
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", {
      name: "Link duplicate profiles",
      exact: true,
    });
    await expect(page.getByRole("dialog")).toBeVisible();
    await dialog
      .getByRole("combobox", { name: "Current profile", exact: true })
      .selectOption(ids.student);
    await dialog
      .getByRole("combobox", { name: "Related duplicate", exact: true })
      .selectOption(duplicateId);
    await dialog
      .getByLabel("Reason")
      .fill("Coach reviewed original history; retain all accounts and access");
    await dialog
      .getByRole("button", { name: "Review change", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", {
        name: "Confirm profile links",
        exact: true,
      }),
    ).toBeEnabled();
    expect(
      state.commands.filter((x) => x.command === "identity_change"),
    ).toHaveLength(0);
    await dialog
      .getByRole("button", { name: "Edit review", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", {
        name: "Confirm profile links",
        exact: true,
      }),
    ).toBeFocused();
    const colors = await dialog.evaluate((element) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const rgba = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      };
      const background = (node: Element | null): number[] => {
        for (let current = node; current; current = current.parentElement) {
          const color = rgba(getComputedStyle(current).backgroundColor);
          if (color[3] === 255) return color;
        }
        return [255, 255, 255, 255];
      };
      const luminance = (color: number[]) =>
        color
          .slice(0, 3)
          .map((x) => x / 255)
          .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
          .reduce((sum, x, n) => sum + x * [0.2126, 0.7152, 0.0722][n], 0);
      const ratio = (one: number[], two: number[]) => {
        const a = luminance(one),
          b = luminance(two);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      const pairs = Array.from(
        element.querySelectorAll(
          "h2,header p,label,select,textarea,button.primary",
        ),
      ).map((node) => {
        const style = getComputedStyle(node),
          bg = background(node),
          fg = rgba(style.color),
          alpha = fg[3] / 255;
        const blended = fg.map((x, n) =>
          n < 3 ? x * alpha + bg[n] * (1 - alpha) : 255,
        );
        const border = rgba(style.borderTopColor),
          borderAlpha = border[3] / 255;
        const visibleBorder = border.map((x, n) =>
          n < 3 ? x * borderAlpha + bg[n] * (1 - borderAlpha) : 255,
        );
        return {
          element: node.tagName,
          foreground: style.color,
          background: bg,
          textRatio: ratio(blended, bg),
          borderRatio: ["SELECT", "TEXTAREA"].includes(node.tagName)
            ? ratio(visibleBorder, bg)
            : null,
        };
      });
      const button = element.querySelector("button.primary")!,
        style = getComputedStyle(button);
      return {
        pairs,
        focus: {
          width: parseFloat(style.outlineWidth),
          style: style.outlineStyle,
          ratio: ratio(
            rgba(style.outlineColor),
            background(button.parentElement),
          ),
        },
      };
    });
    expect(
      Math.min(...colors.pairs.map((pair) => pair.textRatio)),
    ).toBeGreaterThanOrEqual(4.5);
    for (const pair of colors.pairs)
      if (pair.borderRatio !== null)
        expect(pair.borderRatio).toBeGreaterThanOrEqual(3);
    expect(colors.focus.width).toBeGreaterThanOrEqual(2);
    expect(colors.focus.style).not.toBe("none");
    expect(colors.focus.ratio).toBeGreaterThanOrEqual(3);
    writeFileSync(
      `docs/audit-identity/evidence/${info.project.name}-colors-${width}.json`,
      JSON.stringify(colors, null, 2) + "\n",
    );
    const geometry = await dialog.evaluate((element) => ({
      top: element.getBoundingClientRect().top,
      bottom: element.getBoundingClientRect().bottom,
      height: innerHeight,
    }));
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height + 1);
    await page.screenshot({
      path: `docs/audit-identity/evidence/${info.project.name}-review-${width}.png`,
      fullPage: true,
    });
    const audit = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(audit.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await dialog
      .getByRole("button", { name: "Confirm profile links", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      dialog.getByRole("button", { name: "Retry saved request", exact: true }),
    ).toBeVisible();
    await expect(dialog.getByLabel("Reason")).toBeDisabled();
    await page.screenshot({
      path: `docs/audit-identity/evidence/${info.project.name}-recovery-${width}.png`,
      fullPage: true,
    });
    await dialog
      .getByRole("button", { name: "Close review", exact: true })
      .click();
    await expect(opener).toBeFocused();
    await opener.click();
    await dialog
      .getByRole("button", { name: "Retry saved request", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText("Profiles linked.");
    const requests = state.commands.filter(
      (x) => x.command === "identity_change",
    );
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    await dialog
      .getByRole("link", { name: "Open current profile", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp("/coach/students/" + ids.student));
    const related = page.getByRole("region", {
      name: "Related student profiles",
      exact: true,
    });
    await expect(related.getByRole("alert")).toContainText(
      "Synthetic related-profile read unavailable",
    );
    state.historyFailed = true;
    await related
      .getByRole("button", { name: "Retry related profiles" })
      .click();
    await related
      .getByRole("button", { name: "Load more related profiles" })
      .click();
    await expect(
      related.getByText("Showing 26 of 26.", { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: `docs/audit-identity/evidence/${info.project.name}-original-links-${width}.png`,
      fullPage: true,
    });
    const linksAudit = await new AxeBuilder({ page })
      .include('[aria-label="Related student profiles"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(linksAudit.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await related.getByRole("link", { name: /Alex Original/ }).click();
    await expect(page).toHaveURL(new RegExp("/coach/students/" + duplicateId));
    await expect(
      page.getByRole("heading", { name: /Alex Original/, level: 1 }),
    ).toBeVisible();
    await page.goto("/coach/students");
    await page
      .getByRole("button", { name: "Link duplicate profiles", exact: true })
      .click();
    const reversed = page.getByRole("dialog");
    await reversed
      .getByRole("combobox", { name: "Action", exact: true })
      .selectOption("dissolve");
    await reversed
      .getByRole("combobox", { name: "Current profile", exact: true })
      .selectOption(ids.student);
    await reversed
      .getByLabel("Reason")
      .fill(
        "Coach reversed the reviewed group without changing original records",
      );
    await reversed
      .getByRole("button", { name: "Review change", exact: true })
      .click();
    await expect(reversed.getByText(/26 profiles in this group/)).toBeVisible();
    await reversed
      .getByRole("button", { name: "Confirm unlinking", exact: true })
      .click();
    await expect(reversed.getByRole("status")).toContainText(
      "Profiles unlinked.",
    );
    await page.screenshot({
      path: `docs/audit-identity/evidence/${info.project.name}-reversal-${width}.png`,
      fullPage: true,
    });
    const last = state.commands
      .filter((x) => x.command === "identity_change")
      .at(-1)!;
    expect(last.payload).toMatchObject({
      proposal: { action: "dissolve", currentStudentId: ids.student },
    });
    state.held = true;
    await reversed
      .getByRole("combobox", { name: "Action", exact: true })
      .selectOption("group");
    await reversed
      .getByRole("combobox", { name: "Related duplicate", exact: true })
      .selectOption(duplicateId);
    await reversed
      .getByRole("button", { name: "Review change", exact: true })
      .click();
    await expect(
      reversed.getByText(/different signed-in accounts/),
    ).toBeVisible();
    await expect(
      reversed.getByRole("button", {
        name: "Confirm profile links",
        exact: true,
      }),
    ).toBeDisabled();
    await page.screenshot({
      path: `docs/audit-identity/evidence/${info.project.name}-account-hold-${width}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", {
        name: "Link duplicate profiles",
        exact: true,
      }),
    ).toBeFocused();
  });
