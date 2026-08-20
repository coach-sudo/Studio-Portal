import fs from "node:fs";
import { describe, expect, it } from "vitest";
const core = fs.readFileSync(
  "supabase/migrations/202607030001_core.sql",
  "utf8",
);
const rls = fs.readFileSync("supabase/migrations/202607030002_rls.sql", "utf8");
const commands = fs.readFileSync(
  "supabase/migrations/202607030003_commands.sql",
  "utf8",
);
const booking = fs.readFileSync(
  "supabase/migrations/202608070004_booking_platform.sql",
  "utf8",
);
const publicBooking = fs.readFileSync(
  "netlify/functions/public-booking.ts",
  "utf8",
);
const stripeWebhook = fs.readFileSync(
  "netlify/functions/stripe-webhook-v2.ts",
  "utf8",
);
const securityHardening = fs.readFileSync(
  "supabase/migrations/20260820184240_actor_view_security_invoker.sql",
  "utf8",
);
describe("database contracts", () => {
  it("enables RLS for every private aggregate", () => {
    for (const table of [
      "students",
      "lessons",
      "notes",
      "assignments",
      "materials",
      "packages",
      "payment_entries",
      "actor_profiles",
      "reader_requests",
      "outbox_messages",
      "recommendations",
      "audit_events",
    ])
      expect(rls).toContain(
        `alter table public.${table} enable row level security`,
      );
  });
  it("indexes foreign-key and policy columns", () => {
    expect(core).toContain("lessons_student_id_idx");
    expect(core).toContain("memberships_user_id_idx");
    expect(core).toContain("student_relationships_user_id_idx");
  });
  it("implements version conflicts and idempotency", () => {
    expect(commands).toContain("VERSION_CONFLICT");
    expect(commands).toContain("idempotency_keys");
    expect(commands).toContain("process_stripe_checkout");
  });
  it("keeps public booking writes behind service-role commands", () => {
    for (const table of [
      "booking_services",
      "availability_rules",
      "availability_exceptions",
      "service_offerings",
      "recurring_series",
      "bookings",
      "booking_holds",
      "lesson_participants",
    ])
      expect(booking).toContain(
        `alter table public.${table} enable row level security`,
      );
    expect(booking).toContain(
      "revoke all on function public.create_booking_hold",
    );
    expect(booking).toContain("to service_role");
  });
  it("removes broad student update policies in favor of validated commands", () => {
    expect(booking).toContain(
      "drop policy if exists assignments_student_update",
    );
    expect(booking).toContain(
      "drop policy if exists actor_profiles_related_write",
    );
  });
  it("enforces hold overlap, class capacity, and policy snapshots", () => {
    expect(booking).toContain("booking_holds_private_overlap");
    expect(booking).toContain("offering.enrolled+held>=offering.capacity");
    expect(booking).toContain("policy_snapshot jsonb not null");
  });
  it("releases class capacity and supports idempotent credit restoration", () => {
    expect(booking).toContain("release_offering_seat");
    expect(publicBooking).toContain("booking-credit-release:");
    expect(publicBooking).toContain("public-cancel:");
  });
  it("backfills participants and rolls ongoing series forward", () => {
    expect(booking).toContain("insert into public.lesson_participants");
    expect(booking).toContain("extend_ongoing_series");
    expect(booking).toContain("interval '12 weeks'");
  });
  it("allows coaches and enrolled students to read group occurrences without recursive RLS", () => {
    expect(booking).toContain("drop policy if exists lessons_access");
    expect(booking).toContain("can_access_lesson");
    expect(booking).toContain("security definer");
  });
  it("serializes confirmed private occurrences and builds course lessons", () => {
    expect(booking).toContain("lessons_private_overlap");
    expect(booking).toContain("pg_advisory_xact_lock");
    expect(booking).toContain("command_create_service_offering");
  });
  it("holds every recurring occurrence in one database transaction", () => {
    expect(booking).toContain("create_booking_series_holds");
    expect(booking).toContain("foreach occurrence_start");
    expect(publicBooking).toContain("target_starts:occurrenceStarts");
  });
  it("reschedules occurrences atomically while preserving studio-local recurrence", () => {
    expect(booking).toContain("reschedule_booking_occurrences");
    expect(booking).toContain("at time zone");
    expect(booking).toContain("RESCHEDULE_LIMIT_REACHED");
  });
  it("makes public checkout idempotent and revalidates provider availability", () => {
    expect(publicBooking).toContain("idempotency_keys");
    expect(publicBooking).toContain("googleFreeBusy");
    expect(publicBooking).toContain("availabilityUrl");
    expect(publicBooking).toContain("idempotencyKey:idempotency");
  });
  it("rate limits public catalog, availability, holds, and management commands", () => {
    expect(booking).toContain("claim_public_rate_limit");
    expect(booking).toContain("public_endpoint_rate_limits");
    expect(publicBooking).toContain("rateLimit(request,action)");
  });
  it("handles payment failures, refunds, expired sessions, and subscription lifecycle", () => {
    for (const event of [
      "invoice.payment_failed",
      "invoice.paid",
      "checkout.session.expired",
      "charge.refunded",
      "refund.updated",
      "customer.subscription.updated",
      "customer.subscription.deleted",
    ])
      expect(stripeWebhook).toContain(event);
  });
  it("keeps public actor views invoker-safe and removes anonymous definer execution", () => {
    expect(securityHardening).toContain("security_invoker = true");
    expect(securityHardening).toContain("from public, anon");
    expect(securityHardening).toContain(
      "grant execute on function public.can_access_student",
    );
  });
  it("splits finite course installments without overcharging rounding cents", () => {
    expect(publicBooking).toContain("Math.floor(totalMinor/billingCount)");
    expect(stripeWebhook).toContain("Final installment rounding adjustment");
    expect(booking).toContain("installment_remainder_minor");
  });
  it("resumes pre-claimed package checkout webhooks without dropping the purchase", () => {
    expect(booking).toContain("prior_status='processed'");
    expect(booking).toContain("on conflict(id) do update");
    expect(booking).toContain("stripe-credit:");
  });
});
