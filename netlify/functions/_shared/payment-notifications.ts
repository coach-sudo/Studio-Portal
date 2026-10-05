import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.generated";
import { emailDefaults, renderEmailTemplate } from "./email-templates";
import { resolveEventRecipients } from "./notification-recipients";
import {
  compatibleQueueStatus,
  compatibleRule,
  queuePresentedMessages,
} from "./outbox-queue";
import { portalOrigin } from "./portal-url";

export async function queuePaymentFailedEmail(
  client: SupabaseClient,
  bookingId: string,
) {
  const db = client as SupabaseClient<Database>;
  const { data: booking, error } = await db
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .single();
  if (error) throw error;
  const [
    { data: studio, error: studioError },
    { data: service, error: serviceError },
    rule,
  ] = await Promise.all([
    db
      .from("studios")
      .select("name,settings")
      .eq("id", booking.studio_id)
      .single(),
    db
      .from("booking_services")
      .select("name")
      .eq("id", booking.service_id)
      .single(),
    compatibleRule(client, booking.studio_id, "payment_failed"),
  ]);
  if (studioError || serviceError) throw studioError || serviceError;
  if (!booking.student_id)
    throw new Error(
      "VALIDATION_FAILED: A linked payer is required before sending a payment message.",
    );
  const settings = studio!.settings as {
    emailAutomations?: typeof emailDefaults;
    coachName?: string;
    branding?: { logoUrl?: string };
  };
  const automation = { ...emailDefaults, ...settings.emailAutomations };
  const status = compatibleQueueStatus(rule, automation.enabled);
  if (!automation.enabled || !status || booking.payment_status !== "failed")
    return [];
  const resolution = await resolveEventRecipients(
    client,
    booking.student_id,
    "payment_failed",
    { mandatory: true },
  );
  const values = {
    studioName: studio!.name,
    studentName: booking.guest_name,
    serviceName: service!.name,
  };
  return queuePresentedMessages(
    client,
    resolution.recipients.map((recipient) => ({
      studio_id: booking.studio_id,
      student_id: booking.student_id,
      booking_id: booking.id,
      channel: "email",
      recipient: recipient.email,
      recipient_intent: "payment_failed",
      subject: renderEmailTemplate(automation.paymentFailedSubject, values),
      body: renderEmailTemplate(automation.paymentFailedBody, values),
      status,
      send_at: new Date().toISOString(),
      event_key: "payment.failed.student",
      automation_rule_id: rule?.id,
      dedupe_key: `booking:${booking.id}:payment-failed:${recipient.email}`,
      priority: 90,
    })),
    { name: studio!.name, settings },
    portalOrigin(),
  );
}
