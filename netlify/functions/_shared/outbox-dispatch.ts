import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../../../src/types/database.generated";
import { googleAccessToken, sendGmail } from "./google";
import { serviceClient } from "./supabase";
import { checkOutboxEligibility, suppressOutbox } from "./outbox-eligibility";
import { releaseMetadata } from "./release";
import { presentOutboxMessage, type EmailStudio } from "./outbox-presentation";
import { portalOrigin } from "./portal-url";

export async function dispatchOutbox(
  input: { ids?: string[]; batchSize?: number } = {},
) {
  const client = serviceClient(),
    db = client as SupabaseClient<Database>;
  const claimed = input.ids?.length
    ? await db
        .from("outbox_messages")
        .update({ status: "sending", updated_at: new Date().toISOString() })
        .in("id", input.ids)
        .in("status", ["queued", "failed"])
        .lte("send_at", new Date().toISOString())
        .select()
    : await db.rpc("claim_booking_reminders", {
        batch_size: input.batchSize ?? 20,
      });
  if (claimed.error) throw claimed.error;
  const messages = (claimed.data ?? []) as Tables<"outbox_messages">[];
  let sent = 0,
    suppressed = 0,
    token: string | undefined;
  for (const message of messages)
    try {
      const eligibility = await checkOutboxEligibility(
        client,
        message,
        Date.now(),
        { requireApproval: true },
      );
      if (!eligibility.allowed) {
        if (eligibility.reason === "approval_required") {
          const restored = await db
            .from("outbox_messages")
            .update({
              status: "draft",
              updated_at: new Date().toISOString(),
              version: message.version + 1,
            })
            .eq("id", message.id)
            .eq("status", "sending");
          if (restored.error) throw restored.error;
          continue;
        }
        await suppressOutbox(client, message, eligibility.reason);
        suppressed++;
        continue;
      }
      // Isolated browser tests assert queue/state only. Never acquire a real Gmail token there.
      if (
        Netlify.env.get("E2E_EPHEMERAL") === "true" &&
        releaseMetadata().context !== "production"
      ) {
        const restored = await db
          .from("outbox_messages")
          .update({
            status: "queued",
            next_attempt_at: new Date(Date.now() + 3600000).toISOString(),
          })
          .eq("id", message.id)
          .eq("status", "sending");
        if (restored.error) throw restored.error;
        continue;
      }
      token ??= await googleAccessToken();
      // An authoritative trigger may have cancelled this item while provider auth was in flight.
      const current = await db
        .from("outbox_messages")
        .select("*")
        .eq("id", message.id)
        .single();
      if (current.error) throw current.error;
      if (current.data.status !== "sending") continue;
      const final = await checkOutboxEligibility(
        client,
        current.data,
        Date.now(),
        { requireApproval: true },
      );
      if (!final.allowed) {
        await suppressOutbox(client, current.data, final.reason);
        suppressed++;
        continue;
      }
      // SQL note/practice/invite producers use the same final presentation as booking rules.
      // Resolve private branding only at delivery so future queued messages never embed expired URLs.
      const studioResult = await db
        .from("studios")
        .select("name,settings")
        .eq("id", current.data.studio_id)
        .single();
      if (studioResult.error) throw studioResult.error;
      const studio: EmailStudio = {
        name: studioResult.data.name,
        settings: studioResult.data.settings as EmailStudio["settings"],
      };
      const path = studio.settings?.branding?.logoStoragePath;
      if (path) {
        const asset = await db.storage
          .from("studio-materials")
          .createSignedUrl(path, 7 * 86400);
        if (asset.error) throw asset.error;
        studio.settings = {
          ...studio.settings,
          branding: {
            ...studio.settings?.branding,
            logoUrl: asset.data.signedUrl,
          },
        };
      }
      // Already presented messages keep their scoped booking CTA; old plain-text producers
      // receive a trusted authenticated deep link. The presenter strips its own prior footer.
      const scopedAction = current.data.html_body?.match(
        /<a href="([^"]+)"[^>]*>([^<]+)<\/a>/,
      );
      const origin = portalOrigin();
      const action =
        scopedAction &&
        new URL(scopedAction[1].replace(/&amp;/g, "&")).origin === origin
          ? {
              url: scopedAction[1].replace(/&amp;/g, "&"),
              label: scopedAction[2].replace(/&amp;/g, "&"),
            }
          : undefined;
      const presented = presentOutboxMessage(
        current.data,
        studio,
        origin,
        action,
      );
      const result = await sendGmail(token, {
        ...current.data,
        body: presented.text,
        html_body: presented.html,
      });
      const attempt = await db.from("delivery_attempts").insert({
        outbox_message_id: message.id,
        provider: "gmail",
        provider_reference: result.id,
        response: { id: result.id ?? null },
        succeeded: true,
      });
      if (attempt.error) throw attempt.error;
      const updated = await db
        .from("outbox_messages")
        .update({
          status: "sent",
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", message.id)
        .eq("status", "sending");
      if (updated.error) throw updated.error;
      sent++;
    } catch {
      console.error(
        JSON.stringify({
          event: "outbox.delivery_failed",
          correlationId: message.correlation_id ?? message.id,
          code: "PROVIDER_UNAVAILABLE",
        }),
      );
      const attempt = await db.from("delivery_attempts").insert({
        outbox_message_id: message.id,
        provider: "gmail",
        response: {},
        succeeded: false,
        error: "Delivery failed. Check the provider connection.",
      });
      const updated = await db
        .from("outbox_messages")
        .update({
          status: "failed",
          last_error: "Delivery failed. Check the provider connection.",
          next_attempt_at: new Date(Date.now() + 15 * 60000).toISOString(),
        })
        .eq("id", message.id)
        .eq("status", "sending");
      if (attempt.error || updated.error) throw attempt.error ?? updated.error;
    }
  return { processed: messages.length, sent, suppressed };
}
