import { describe, expect, it } from "vitest";
import {
  renderCampaignTemplate,
  unknownCampaignTokens,
} from "./campaignTemplates";

describe("campaign templates", () => {
  it("personalizes known fields while preserving plain text", () => {
    expect(
      renderCampaignTemplate("Hi {{firstName}}, visit {{portalUrl}}", {
        firstName: "Maya",
        fullName: "Maya Chen",
        email: "maya@example.com",
        studioName: "Studio",
        portalUrl: "https://example.com/portal",
        unsubscribeUrl: "https://example.com/unsubscribe/token",
      }),
    ).toBe("Hi Maya, visit https://example.com/portal");
  });

  it("flags unknown fields before a campaign is queued", () => {
    expect(
      unknownCampaignTokens("Hi {{firstName}}, {{secret}} {{secret}}"),
    ).toEqual(["secret"]);
  });
});
