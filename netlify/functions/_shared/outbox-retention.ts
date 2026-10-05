import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.generated";

/** Keep delivery history, but remove every stored rendering of expired temporary credentials. */
export async function clearDeliveredPortalCredentials(
  db: SupabaseClient<Database>,
  before: string,
) {
  const result = await db
    .from("outbox_messages")
    .update({
      body: "Temporary portal credentials removed after delivery retention period.",
      html_body: null,
    })
    .eq("event_key", "portal.credentials")
    .eq("status", "sent")
    .lt("updated_at", before);
  if (result.error) throw result.error;
}
