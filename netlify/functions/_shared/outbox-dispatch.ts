import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "../../../src/types/database.generated";
import { googleAccessToken, sendGmail } from "./google";
import { serviceClient } from "./supabase";
import { checkOutboxEligibility, suppressOutbox } from "./outbox-eligibility";
import { releaseMetadata } from "./release";

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
      const eligibility = await checkOutboxEligibility(client, message);
      if (!eligibility.allowed) {
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
      const final = await checkOutboxEligibility(client, current.data);
      if (!final.allowed) {
        await suppressOutbox(client, current.data, final.reason);
        suppressed++;
        continue;
      }
      const result = await sendGmail(token, current.data);
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
