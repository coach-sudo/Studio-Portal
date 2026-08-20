import type { StudioSettings } from "../domain/model";

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
    if (value) root.style.setProperty(property, value);
  }
}
