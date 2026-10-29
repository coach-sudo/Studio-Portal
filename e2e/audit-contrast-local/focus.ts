import { expect, type Locator, type Page } from "@playwright/test";

/** Inspect the rendered application's complete cascade, including the legacy global !important rule. */
export async function inspectPublicFocus(
  page: Page,
  control: Locator,
  state: string,
) {
  // Enter keyboard modality before focusing a named control. The journey separately activates controls with Enter.
  await page.keyboard.press("Tab");
  await control.focus();
  await expect(control).toBeFocused();
  const observation = await control.evaluate((element, state) => {
    const style = getComputedStyle(element);
    const rgba = (value: string) => {
      const channels = (value.match(/[\d.]+/g) ?? []).map(Number);
      if (value.startsWith("color(srgb")) {
        return [
          channels[0] * 255,
          channels[1] * 255,
          channels[2] * 255,
          channels[3] ?? 1,
        ];
      }
      return [channels[0], channels[1], channels[2], channels[3] ?? 1];
    };
    const over = (foreground: number[], background: number[]) => [
      ...foreground
        .slice(0, 3)
        .map(
          (channel, i) =>
            channel * foreground[3] + background[i] * (1 - foreground[3]),
        ),
      1,
    ];
    const luminance = (channels: number[]) =>
      channels
        .slice(0, 3)
        .map((channel) => {
          const n = channel / 255;
          return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
        })
        .reduce(
          (sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i],
          0,
        );
    const ratio = (foreground: number[], background: number[]) => {
      const a = luminance(foreground),
        b = luminance(background);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const ancestors = [];
    for (
      let ancestor = element.parentElement;
      ancestor;
      ancestor = ancestor.parentElement
    )
      ancestors.push({
        tag: ancestor.tagName,
        background: getComputedStyle(ancestor).backgroundColor,
      });
    const background = [...ancestors]
      .reverse()
      .reduce(
        (composite, ancestor) => over(rgba(ancestor.background), composite),
        [255, 255, 255, 1],
      );
    const haloColor = style.boxShadow.match(
      /(?:rgba?\([^)]*\)|color\(srgb[^)]*\))/,
    )?.[0];
    const outer = over(rgba(style.outlineColor), background);
    // WebKit's native checkboxes can omit shadows; their opaque outline must then pass by itself.
    const inner = haloColor ? over(rgba(haloColor), background) : null;
    return {
      state,
      tag: element.tagName,
      name:
        element.getAttribute("aria-label") ||
        element.textContent?.trim().slice(0, 100) ||
        (element as HTMLInputElement).name,
      focusVisible: element.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineOffset: style.outlineOffset,
      outlineColor: style.outlineColor,
      boxShadow: style.boxShadow,
      haloColor,
      ancestorBackgrounds: ancestors,
      adjacentComposite: background,
      outlineComposite: outer,
      haloComposite: inner,
      outlineContrast: ratio(outer, background),
      haloContrast: inner ? ratio(inner, background) : null,
      effectiveContrast: Math.max(
        ratio(outer, background),
        inner ? ratio(inner, background) : 0,
      ),
    };
  }, state);
  expect(observation.focusVisible).toBe(true);
  expect(observation.outlineStyle).toBe("solid");
  expect(observation.outlineWidth).toBe("2px");
  expect(observation.outlineColor).toBe("rgb(0, 0, 0)");
  if (observation.haloColor)
    expect(observation.haloColor).toBe("rgb(255, 255, 255)");
  expect(observation.effectiveContrast).toBeGreaterThanOrEqual(3);
  return observation;
}
