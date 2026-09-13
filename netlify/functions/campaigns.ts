import type { Config } from "@netlify/functions";
import { z } from "zod";
import { unknownCampaignTokens } from "../../src/domain/campaignTemplates";
import { apiError, json } from "./_shared/http";
import { serviceClient, userClient } from "./_shared/supabase";

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

    if (request.method === "GET") {
      const [contactsResult, preferencesResult, historyResult] =
        await Promise.all([
          db.rpc("current_campaign_contacts", { p_studio_id: studioId }),
          db
            .from("mailing_list_contacts")
            .select("email,unsubscribed_at")
            .eq("studio_id", studioId),
          db.rpc("campaign_delivery_stats", { p_studio_id: studioId }),
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
      return json({ contacts, campaigns: historyResult.data || [] });
    }

    const input = sendSchema.parse(await request.json());
    const unknown = unknownCampaignTokens(`${input.subject}\n${input.body}`);
    if (unknown.length)
      throw new Error(
        `VALIDATION_FAILED: Unknown template field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`,
      );
    const baseUrl = (
      Netlify.env.get("URL") || new URL(request.url).origin
    ).replace(/\/$/, "");
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
