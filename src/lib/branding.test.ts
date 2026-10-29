import { afterEach, expect, it } from "vitest";
import { applyStudioBranding, brandingForeground } from "./branding";
afterEach(() => document.documentElement.removeAttribute("style"));
it("pairs production and light branding with readable foregrounds", () => {
  applyStudioBranding({
    primaryColor: "#37129b",
    secondaryColor: "#a7d3eb",
    surfaceColor: "#c2daff",
    accentColor: "#cf1b96",
  });
  const style = document.documentElement.style;
  expect(style.getPropertyValue("--on-forest")).toBe("#ffffff");
  expect(style.getPropertyValue("--on-gold")).toBe("#000000");
  expect(brandingForeground("#fff")).toBe("#000000");
  expect(brandingForeground("#000")).toBe("#ffffff");
});
