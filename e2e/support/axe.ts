import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function expectNoSeriousAxeViolations(
  page: Page,
  include?: string,
) {
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
