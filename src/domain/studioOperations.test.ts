import { describe, it, expect } from "vitest";
import {
  campaignStartingTemplate,
  campaignContentSchema,
  renderCampaignContent,
} from "./campaignBlocks";
import {
  actorLayoutSchema,
  readActorLayout,
  moveActorSection,
  classicActorLayout,
} from "./actorLayout";
import { settingsPatch } from "./settingsPatch";
import { canonicalSettingsPanel, settingsPanels } from "./settingsPanels";
import { presentOutboxMessage } from "../../netlify/functions/_shared/outbox-presentation";
const values = {
  firstName: "<img src=x onerror=alert(1)>",
  fullName: "Taylor",
  email: "taylor@example.test",
  studioName: "Studio & Company",
  portalUrl: "https://staging.example.test/portal",
  unsubscribeUrl: "https://staging.example.test/unsubscribe/reviewed",
};
describe("campaign rendering and delivery boundaries", () => {
  it("uses identical safe HTML/plain text for preview and delivery", () => {
    const content = campaignStartingTemplate("studio-news"),
      preview = renderCampaignContent(content, values);
    expect(preview.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(preview.html).not.toContain("<script");
    expect(preview.html).toContain("Unsubscribe from studio campaigns");
    expect(
      presentOutboxMessage(
        {
          body: "Ignored legacy fallback",
          event_key: "campaign.email",
          entity_snapshot: { campaignContent: content, campaignValues: values },
        },
        { name: values.studioName },
        "https://staging.example.test",
      ),
    ).toEqual(preview);
  });
  it("rejects executable URLs, duplicate IDs, unknown placeholders and another origin", () => {
    const content = campaignStartingTemplate("announcement");
    expect(
      campaignContentSchema.safeParse({
        version: 1,
        blocks: [
          {
            id: crypto.randomUUID(),
            type: "image",
            alt: "Preview",
            url: "{{unsubscribeUrl}}",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      campaignContentSchema.safeParse({
        version: 1,
        blocks: [
          {
            id: crypto.randomUUID(),
            type: "button",
            label: "Unsafe",
            url: "javascript:alert(1)",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      campaignContentSchema.safeParse({
        ...content,
        blocks: [content.blocks[0], content.blocks[0]],
      }).success,
    ).toBe(false);
    expect(
      campaignContentSchema.safeParse({
        ...content,
        blocks: [
          { id: crypto.randomUUID(), type: "text", text: "{{privateNote}}" },
        ],
      }).success,
    ).toBe(false);
    expect(() =>
      presentOutboxMessage(
        {
          body: "",
          entity_snapshot: {
            campaignContent: content,
            campaignValues: {
              ...values,
              portalUrl: "https://production.example.test/portal",
            },
          },
        },
        { name: "Studio" },
        "https://staging.example.test",
      ),
    ).toThrow("origin mismatch");
  });
});
describe("Actor layout compatibility", () => {
  it("preserves legacy Classic rendering and only reorders approved section identities", () => {
    expect(readActorLayout(undefined)).toEqual(classicActorLayout);
    const order = moveActorSection(classicActorLayout.sections, "media", 0);
    expect(order[0]).toBe("media");
    expect(classicActorLayout.sections[0]).toBe("biography");
    expect(
      actorLayoutSchema.safeParse({
        version: 1,
        layout: "spotlight",
        sections: ["biography", "biography", "media", "skills", "credits"],
      }).success,
    ).toBe(false);
  });
});
describe("Settings patches and compatibility URLs", () => {
  it("sends only changed nested fields and deliberate removals", () => {
    expect(
      settingsPatch(
        {
          branding: { primaryColor: "#111111", logoStoragePath: "old" },
          coachName: "Saved",
        },
        {
          branding: { primaryColor: "#222222", logoStoragePath: undefined },
          coachName: "Saved",
        },
      ),
    ).toEqual({ branding: { primaryColor: "#222222", logoStoragePath: null } });
  });
  it("supports every canonical category and existing links", () => {
    for (const panel of settingsPanels)
      expect(canonicalSettingsPanel(panel)).toBe(panel);
    expect(canonicalSettingsPanel("studio")).toBe("profile");
    expect(canonicalSettingsPanel("portal")).toBe("access");
    expect(canonicalSettingsPanel("popup")).toBe("communications");
    expect(canonicalSettingsPanel("email")).toBe("communications");
    expect(canonicalSettingsPanel("forged")).toBe("profile");
  });
});
