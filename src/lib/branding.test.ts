import { afterEach, expect, it } from "vitest";
import {
  applyStudioBranding,
  brandingForeground,
  colorContrast,
} from "./branding";

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

it("keeps every representative solid fill at 4.5:1 or better and moves hover away from the text color", () => {
  for (const primaryColor of [
    "#ffffff",
    "#f1e9a8",
    "#787878",
    "#75007e",
    "#163a30",
    "#000000",
  ]) {
    applyStudioBranding({ primaryColor });
    const style = document.documentElement.style;
    const foreground = style.getPropertyValue("--on-forest");
    expect(colorContrast(foreground, primaryColor)).toBeGreaterThanOrEqual(4.5);
    expect(style.getPropertyValue("--primary-hover-tint")).toBe(
      foreground === "#000000" ? "#ffffff" : "#000000",
    );
  }
});

it("keeps canvas, muted labels, and brand text readable and clears invalid theme overrides", () => {
  applyStudioBranding({ primaryColor: "#f9f4c5", surfaceColor: "#41505c" });
  const style = document.documentElement.style;
  const canvas = style.getPropertyValue("--accessible-canvas");
  const foreground = style.getPropertyValue("--brand-text-on-light");
  expect(colorContrast("#526258", canvas)).toBeGreaterThanOrEqual(4.5);
  expect(colorContrast(foreground, canvas)).toBeGreaterThanOrEqual(4.5);
  expect(colorContrast(foreground, "#fff")).toBeGreaterThanOrEqual(4.5);
  applyStudioBranding({ primaryColor: "transparent" });
  expect(style.getPropertyValue("--forest")).toBe("");
  expect(style.getPropertyValue("--on-forest")).toBe("");
});
