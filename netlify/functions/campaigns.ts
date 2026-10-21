import type { Config } from "@netlify/functions";
import { z } from "zod";
import { unknownCampaignTokens } from "../../src/domain/campaignTemplates";
import { apiError, json } from "./_shared/http";
import { serviceClient, userClient } from "./_shared/supabase";
import { portalOrigin } from "./_shared/portal-url";
import {
  campaignContentSchema,
  renderCampaignContent,
} from "../../src/domain/campaignBlocks";
import { campaignTokens } from "../../src/domain/campaignTemplates";

const sendSchema = z.object({
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  subject: z.string().trim().min(2).max(200),
  body: z.string().trim().min(2).max(10000),
});

export default async (request: Request) => {
  try {
    if (request.method !== "GET" && request.method !== "POST")
      return json({ message: "Method not allowed." }, 405);
    const user = userClient(request);
    const { data: membership, error: membershipError } = await user
      .from("memberships")
      .select("studio_id")
      .eq("role", "coach")
      .limit(1)
      .maybeSingle();
    if (membershipError || !membership) throw new Error("FORBIDDEN");
    const studioId = membership.studio_id as string;
    const db = serviceClient();
    const auth = await user.auth.getUser();
    if (auth.error || !auth.data.user) throw new Error("FORBIDDEN");
    const workflow = async (
      command: string,
      draftId: string | null,
      value: Record<string, unknown> = {},
      version = 0,
      key: string = crypto.randomUUID(),
    ) => {
      const r = await db.rpc(
        "manage_campaign_draft" as never,
        {
          p_actor: auth.data.user!.id,
          p_draft: draftId,
          p_command: command,
          p_value: value,
          p_version: version,
          p_key: key,
          p_origin: portalOrigin(),
        } as never,
      );
      if (r.error) throw r.error;
      return r.data;
    };

    if (request.method === "GET") {
      const [contactsResult, preferencesResult, historyResult] =
        await Promise.all([
          db.rpc("current_campaign_contacts", { p_studio_id: studioId }),
          db
            .from("mailing_list_contacts")
            .select("email,unsubscribed_at")
            .eq("studio_id", studioId),
          db.rpc(
            "campaign_history" as never,
            {
              p_actor: auth.data.user.id,
              p_page: Math.max(
                1,
                Number(new URL(request.url).searchParams.get("page")) || 1,
              ),
              p_search: new URL(request.url).searchParams.get("search") || "",
            } as never,
          ),
        ]);
      if (contactsResult.error) throw contactsResult.error;
      if (preferencesResult.error) throw preferencesResult.error;
      if (historyResult.error) throw historyResult.error;
      const optedOut = new Set(
        (preferencesResult.data || [])
          .filter(
            (item: { unsubscribed_at: string | null }) => item.unsubscribed_at,
          )
          .map((item: { email: string }) => item.email),
      );
      const contacts = (contactsResult.data || []).map(
        (item: { email: string; display_name: string }) => ({
          email: item.email as string,
          name: item.display_name as string,
          subscribed: !optedOut.has(item.email),
        }),
      );
      const drafts = (await workflow("list", null)) as unknown as {
        items: unknown[];
      };
      const history = historyResult.data as unknown as {
        items: unknown[];
        count: number;
      };
      return json({
        contacts,
        campaigns: history.items,
        historyCount: history.count,
        drafts: drafts.items,
      });
    }

    const body = await request.json();
    if (body.command) {
      const command = z
          .enum(["read", "save", "review", "queue"])
          .parse(body.command),
        draftId = z.string().uuid().parse(body.draftId),
        version = z.number().int().nonnegative().parse(body.version),
        key = z.string().uuid().parse(body.idempotencyKey);
      let value: Record<string, unknown> = {};
      if (command === "save") {
        const v = z
          .object({
            name: z.string().trim().min(2).max(120),
            subject: z.string().trim().min(2).max(200),
            content: campaignContentSchema,
            recipientEmails: z
              .array(
                z
                  .string()
                  .email()
                  .transform((s) => s.toLowerCase()),
              )
              .max(5000),
            sendAt: z.string().datetime().nullable(),
          })
          .parse(body.value);
        if (unknownCampaignTokens(v.subject).length)
          throw new Error("VALIDATION_FAILED: Unknown subject template field.");
        const values = Object.fromEntries(
          campaignTokens.map((k) => [k, `{{${k}}}`]),
        ) as Record<(typeof campaignTokens)[number], string>;
        value = {
          ...v,
          textTemplate: renderCampaignContent(v.content, values).text,
        };
      } else if (command === "queue")
        value = { reviewId: z.string().uuid().parse(body.value?.reviewId) };
      return json({
        resource: await workflow(command, draftId, value, version, key),
      });
    }
    const input = sendSchema.parse(body);
    const unknown = unknownCampaignTokens(`${input.subject}\n${input.body}`);
    if (unknown.length)
      throw new Error(
        `VALIDATION_FAILED: Unknown template field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`,
      );
    const baseUrl = portalOrigin();
    if (!baseUrl.startsWith("https://"))
      throw new Error(
        "VALIDATION_FAILED: Secure site URL is required for unsubscribe links.",
      );
    const { data, error } = await db.rpc("queue_email_campaign", {
      p_studio_id: studioId,
      p_idempotency_key: input.idempotencyKey,
      p_name: input.name,
      p_subject_template: input.subject,
      p_body_template: input.body,
      p_base_url: baseUrl,
    });
    if (error) throw error;
    return json({ campaign: data }, 201);
  } catch (error) {
    return apiError(error, crypto.randomUUID());
  }
};

export const config: Config = { path: "/api/v2/admin/campaigns" };
