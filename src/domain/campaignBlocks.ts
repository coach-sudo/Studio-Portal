import { z } from "zod";
import {
  renderCampaignTemplate,
  unknownCampaignTokens,
  type CampaignValues,
} from "./campaignTemplates";
const text = z.string().max(10000),
  url = z
    .string()
    .max(2000)
    .refine(
      (s) =>
        /^https:\/\/[^\s<>"']+$/.test(s) ||
        ["{{portalUrl}}", "{{unsubscribeUrl}}"].includes(s),
      "Use an HTTPS URL or a supported portal link",
    );
export const campaignBlockSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().uuid(),
    type: z.literal("heading"),
    text: text.min(1),
  }),
  z.object({ id: z.string().uuid(), type: z.literal("text"), text }),
  z.object({
    id: z.string().uuid(),
    type: z.literal("image"),
    url: url.refine(
      (s) => !s.includes("{{"),
      "Images require an HTTPS image URL, not an account or unsubscribe link",
    ),
    alt: z.string().min(1).max(300),
  }),
  z.object({
    id: z.string().uuid(),
    type: z.literal("button"),
    url,
    label: z.string().min(1).max(120),
  }),
  z.object({ id: z.string().uuid(), type: z.literal("divider") }),
  z.object({
    id: z.string().uuid(),
    type: z.literal("columns"),
    left: text,
    right: text,
  }),
]);
export const campaignContentSchema = z
  .object({
    version: z.literal(1),
    blocks: z.array(campaignBlockSchema).min(1).max(60),
  })
  .refine(
    (c) => new Set(c.blocks.map((b) => b.id)).size === c.blocks.length,
    "Block IDs must be unique",
  )
  .refine(
    (c) => unknownCampaignTokens(JSON.stringify(c)).length === 0,
    "Unknown template field",
  );
export type CampaignBlock = z.infer<typeof campaignBlockSchema>;
export type CampaignContent = z.infer<typeof campaignContentSchema>;
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderCampaignContent(input: unknown, values: CampaignValues) {
  const content = campaignContentSchema.parse(input),
    render = (s: string) => renderCampaignTemplate(s, values),
    htmlText = (s: string) => escape(render(s)).replace(/\n/g, "<br>");
  const parts = content.blocks.map((b) => {
    switch (b.type) {
      case "heading":
        return {
          html: `<h2 style="color:#183c36;font:700 26px Arial;margin:0 0 16px">${htmlText(b.text)}</h2>`,
          text: render(b.text),
        };
      case "text":
        return {
          html: `<p style="font:16px/1.6 Arial;color:#20332e;margin:0 0 18px">${htmlText(b.text)}</p>`,
          text: render(b.text),
        };
      case "image":
        return {
          html: `<img src="${escape(render(b.url))}" alt="${escape(b.alt)}" width="560" style="display:block;max-width:100%;height:auto;border:0;margin:0 0 18px">`,
          text: `${b.alt}: ${render(b.url)}`,
        };
      case "button":
        return {
          html: `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#183c36" style="border-radius:8px;padding:14px 20px"><a href="${escape(render(b.url))}" style="color:#ffffff;text-decoration:none;font:bold 16px Arial">${htmlText(b.label)}</a></td></tr></table>`,
          text: `${render(b.label)}: ${render(b.url)}`,
        };
      case "divider":
        return {
          html: '<hr style="border:0;border-top:1px solid #d8dfd9;margin:24px 0">',
          text: "—",
        };
      case "columns":
        return {
          html: `<table role="presentation" width="100%" cellpadding="8" cellspacing="0"><tr><td width="50%" valign="top" style="font:16px/1.6 Arial;color:#20332e">${htmlText(b.left)}</td><td width="50%" valign="top" style="font:16px/1.6 Arial;color:#20332e">${htmlText(b.right)}</td></tr></table>`,
          text: `${render(b.left)}\n\n${render(b.right)}`,
        };
    }
  });
  return {
    html: `<!doctype html><html><body style="margin:0;background:#f4f5f1;color:#20332e"><table role="presentation" width="100%" cellpadding="16" cellspacing="0"><tr><td align="center"><table role="presentation" width="600" cellpadding="20" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff"><tr><td><p style="font:bold 14px Arial;color:#183c36">${escape(values.studioName)}</p>${parts.map((p) => p.html).join("")}<p style="font:12px Arial;color:#52625b;margin-top:28px"><a href="${escape(values.unsubscribeUrl)}" style="color:#365f51">Unsubscribe from studio campaigns</a></p></td></tr></table></td></tr></table></body></html>`,
    text:
      parts.map((p) => p.text).join("\n\n") +
      `\n\n${values.studioName}\nUnsubscribe: ${values.unsubscribeUrl}`,
  };
}
export function campaignStartingTemplate(
  kind: "announcement" | "lesson-update" | "studio-news",
): CampaignContent {
  const title = {
    announcement: "Studio announcement",
    "lesson-update": "Your lesson update",
    "studio-news": "Studio news",
  }[kind];
  return {
    version: 1,
    blocks: [
      { id: crypto.randomUUID(), type: "heading", text: title },
      {
        id: crypto.randomUUID(),
        type: "text",
        text: "Hi {{firstName}},\n\nAdd your update here.",
      },
      ...(kind === "studio-news"
        ? [
            {
              id: crypto.randomUUID(),
              type: "columns" as const,
              left: "Coming up",
              right: "From the studio",
            },
          ]
        : []),
      {
        id: crypto.randomUUID(),
        type: "button",
        label: "Open your portal",
        url: "{{portalUrl}}",
      },
    ],
  };
}
