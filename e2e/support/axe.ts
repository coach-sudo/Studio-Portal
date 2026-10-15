import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function expectNoSeriousAxeViolations(
  page: Page,
  include?: string,
) {
  // Audit the settled interface, not an intermediate translucent drawer frame.
  // Infinite loading animations are deliberately excluded; no rule is disabled.
  await page.evaluate(async () => {
    const animations = document.getAnimations().filter((animation) => {
      const end = Number(animation.effect?.getComputedTiming().endTime);
      return (
        animation.playState === "running" && Number.isFinite(end) && end <= 2000
      );
    });
    await Promise.allSettled(animations.map((animation) => animation.finished));
  });
  let builder = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
  ]);
  if (include) builder = builder.include(include);
  const result = await builder.analyze();
  const serious = result.violations.filter((item) =>
    ["serious", "critical"].includes(item.impact || ""),
  );
  expect(
    serious,
    serious
      .map(
        (item) =>
          `${item.id}: ${item.help} (${item.nodes.map((node) => node.target.join(" ")).join(", ")})`,
      )
      .join("\n"),
  ).toEqual([]);
}
