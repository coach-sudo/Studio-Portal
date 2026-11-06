import type { SupabaseClient } from "@supabase/supabase-js";
import { queueBookingEmails } from "./booking-email";
import { assertWorkerEnabled } from "./worker-controls";

type Effect = {
  id: string;
  booking_id: string;
  manage_token: string;
  claim_token: string;
};
export async function processManualBookingEffects(db: SupabaseClient) {
  assertWorkerEnabled("booking-maintenance");
  assertWorkerEnabled("automations");
  const claimed = await db.rpc("claim_manual_booking_effects", { p_limit: 10 });
  if (claimed.error) throw claimed.error;
  const effects = (claimed.data ?? []) as Effect[];
  for (const effect of effects) {
    assertWorkerEnabled("booking-maintenance");
    assertWorkerEnabled("automations");
    const current = await db.rpc("manual_booking_effect_current", {
      p_id: effect.id,
      p_token: effect.claim_token,
    });
    if (current.error) throw current.error;
    let failed = false;
    if (current.data) {
      try {
        await queueBookingEmails(db, effect.booking_id, effect.manage_token);
      } catch {
        failed = true;
      }
    }
    const finished = await db.rpc("finish_manual_booking_effect", {
      p_id: effect.id,
      p_token: effect.claim_token,
      p_failed: failed,
    });
    if (finished.error) throw finished.error;
    if (!finished.data) throw new Error("Manual booking effect claim expired.");
    if (failed)
      throw new Error(
        "PROVIDER_UNAVAILABLE: Booking notification production remains pending.",
      );
  }
  return effects.length;
}
