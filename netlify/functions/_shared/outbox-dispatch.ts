import { googleAccessToken, sendGmail } from "./google";
import { serviceClient } from "./supabase";

export async function dispatchOutbox(input: { ids?: string[]; batchSize?: number } = {}) {
  const db = serviceClient();
  let messages: any[] = [];
  if (input.ids?.length) {
    const { data, error } = await db.from("outbox_messages").update({ status: "sending", attempts: 1, updated_at: new Date().toISOString() }).in("id", input.ids).in("status", ["queued", "failed"]).select();
    if (error) throw error;
    messages = data || [];
  } else {
    const { data, error } = await db.rpc("claim_booking_reminders", { batch_size: input.batchSize || 20 });
    if (error) throw error;
    messages = data || [];
  }
  if (!messages.length) return { processed: 0, sent: 0 };
  let token: string;
  try { token = await googleAccessToken(); }
  catch (error) {
    for (const message of messages) await db.from("outbox_messages").update({ status: "failed", last_error: String(error), next_attempt_at: new Date(Date.now() + 15 * 60000).toISOString() }).eq("id", message.id);
    throw error;
  }
  let sent = 0;
  for (const message of messages) {
    try {
      const result = await sendGmail(token, message);
      await db.from("delivery_attempts").insert({ outbox_message_id: message.id, provider: "gmail", provider_reference: result.id, response: result, succeeded: true });
      await db.from("outbox_messages").update({ status: "sent", last_error: null, updated_at: new Date().toISOString() }).eq("id", message.id);
      sent += 1;
    } catch (error) {
      await db.from("delivery_attempts").insert({ outbox_message_id: message.id, provider: "gmail", response: {}, succeeded: false, error: String(error) });
      await db.from("outbox_messages").update({ status: "failed", last_error: String(error), next_attempt_at: new Date(Date.now() + Math.min(60, Number(message.attempts || 1) * 10) * 60000).toISOString() }).eq("id", message.id);
    }
  }
  return { processed: messages.length, sent };
}
