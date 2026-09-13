export const campaignTokens = [
  "firstName",
  "fullName",
  "email",
  "studioName",
  "portalUrl",
  "unsubscribeUrl",
] as const;

export type CampaignValues = Record<(typeof campaignTokens)[number], string>;

export function unknownCampaignTokens(template: string) {
  const allowed = new Set<string>(campaignTokens);
  return [
    ...new Set(
      [...template.matchAll(/{{([^{}]+)}}/g)]
        .map((match) => match[1])
        .filter((name) => !allowed.has(name)),
    ),
  ];
}

export function renderCampaignTemplate(
  template: string,
  values: CampaignValues,
) {
  return template.replace(/{{([^{}]+)}}/g, (match, rawName: string) => {
    const name = rawName as keyof CampaignValues;
    return Object.hasOwn(values, name) ? values[name] : match;
  });
}
