import type { StudioSettings } from "../domain/model";

/** Choose the higher-contrast opaque foreground for configured color-picker hex values. */
export function brandingForeground(background: string) {
  const hex = background.replace(/^#/, "");
  if (!/^(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(hex)) return undefined;
  const expanded = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const channels = [0, 2, 4].map((i) => {
    const value = parseInt(expanded.slice(i, i + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance =
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
    ? "#000000"
    : "#ffffff";
}

export function applyStudioBranding(
  branding?: Partial<StudioSettings["branding"]>,
) {
  if (!branding) return;
  const root = document.documentElement;
  const values: Array<[string, string | undefined]> = [
    ["--forest", branding.primaryColor],
    ["--gold", branding.secondaryColor],
    ["--coral", branding.accentColor],
    ["--surface", branding.surfaceColor],
  ];
  for (const [property, value] of values) {
    if (value) {
      root.style.setProperty(property, value);
      const foreground = brandingForeground(value);
      if (foreground)
        root.style.setProperty(`--on-${property.slice(2)}`, foreground);
    }
  }
}
