export const settingsPanels = [
  "profile",
  "pricing",
  "booking",
  "communications",
  "integrations",
  "access",
  "data",
] as const;
export type SettingsPanel = (typeof settingsPanels)[number];
export function canonicalSettingsPanel(value: string | null): SettingsPanel {
  const alias: Record<string, SettingsPanel> = {
    studio: "profile",
    portal: "access",
    popup: "communications",
    email: "communications",
  };
  return (
    alias[value || ""] ||
    (settingsPanels.includes(value as SettingsPanel)
      ? (value as SettingsPanel)
      : "profile")
  );
}
