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
const productionCloseout = fs.readFileSync(
  "supabase/migrations/20260826072918_close_production_workflow_gaps.sql",
  "utf8",
);
const portalAccountHardening = fs.readFileSync(
  "supabase/migrations/20260826073351_portal_account_grants_and_whiteboard_removal.sql",
  "utf8",
);
const optionalBookingPortalInvites = fs.readFileSync(
  "supabase/migrations/20260826190425_optional_booking_portal_invites.sql",
  "utf8",
);
const publicBooking = fs.readFileSync(
  "netlify/functions/public-booking.ts",
  "utf8",
);
const portalAccess = fs.readFileSync(
  "netlify/functions/_shared/portal-access.ts",
  "utf8",
);
const bookingCancellation = fs.readFileSync(
  "netlify/functions/_shared/booking-cancellation.ts",
  "utf8",
);
const compactPublicBooking = publicBooking.replace(/\s+/g, "");
const stripeWebhook = fs.readFileSync(
  "netlify/functions/stripe-webhook-v2.ts",
  "utf8",
);
const compactStripeWebhook = stripeWebhook.replace(/\s+/g, "");
const studentWorkspace = fs.readFileSync(
  "src/features/coach/StudentWorkspace.tsx",
  "utf8",
);
const securityHardening = fs.readFileSync(
  "supabase/migrations/20260820184240_actor_view_security_invoker.sql",
  "utf8",
);
const lessonRlsHotfix = fs.readFileSync(
  "supabase/migrations/20260902223243_fix_lesson_rls_recursion.sql",
  "utf8",
);
const householdPackageHardening = fs.readFileSync(
  "supabase/migrations/20260902223544_harden_household_and_package_lifecycle.sql",
  "utf8",
);
const procedureLintRepair = fs.readFileSync(
  "supabase/migrations/20260903161123_repair_legacy_procedure_lint.sql",
  "utf8",
);
const bookingMaintenance = fs.readFileSync(
  "netlify/functions/booking-maintenance.ts",
  "utf8",
);
const commandFunction = fs.readFileSync("netlify/functions/v2.ts", "utf8");
const studentPortal = fs.readFileSync(
  "src/features/student/StudentPortal.tsx",
  "utf8",
);
const verifiedEmailClaim = fs.readFileSync(
  "supabase/migrations/20260905141058_google_portal_identity_claim.sql",
  "utf8",
);
const loginPage = fs.readFileSync("src/features/auth/MagicLinkLogin.tsx", "utf8");
const authCallback = fs.readFileSync("src/features/auth/AuthCallback.tsx", "utf8");
const portalAuth = fs.readFileSync("netlify/functions/portal-auth.ts", "utf8");
describe("database contracts", () => {
  it("links verified Google identities to enabled portal profiles without trusting client email", () => {
    expect(verifiedEmailClaim).toContain("email_confirmed_at is not null");
    expect(verifiedEmailClaim).toContain("lower(trim(s.email)) = verified_email");
    expect(verifiedEmailClaim).toContain("lower(trim(c.email)) = verified_email");
    expect(verifiedEmailClaim).toContain("c.portal_enabled");
    expect(verifiedEmailClaim).toContain("PORTAL_IDENTITY_CONFLICT");
    expect(verifiedEmailClaim).toContain("AMBIGUOUS_STUDENT_EMAIL");
    expect(verifiedEmailClaim).toContain("revoke all on function public.claim_portal_access_by_verified_email");
    expect(verifiedEmailClaim).toContain("to service_role");
    expect(portalAuth).toContain('context.params.action === "claim-access"');
    expect(portalAuth).toContain("user.email_confirmed_at");
    expect(portalAccess).not.toContain("existingIdentity.user_metadata?.student_id");
    expect(studentWorkspace).toContain("Send new portal invite");
    expect(loginPage).toContain("For coaches, students, guardians, and support people");
    expect(loginPage).toContain('/auth/callback?returnTo=');
    expect(authCallback).toContain('/api/v2/auth/claim-access');
    expect(authCallback).toContain("await supabase.auth.signOut()");
    expect(studentPortal).toContain("All lesson lengths");
    expect(studentPortal).toContain("Shortest lessons first");
    expect(studentPortal).toContain("Longest lessons first");
  });
  it("keeps legacy procedures lint-clean without weakening their signatures or grants", () => {
    expect(procedureLintRepair).toContain("calendar_projections_lesson_id_key");
    expect(procedureLintRepair).toContain("lesson_participants_lesson_id_email_key");
    expect(procedureLintRepair).toContain("private.reader_requests");
    expect(procedureLintRepair).toContain("extensions.digest");
    expect(procedureLintRepair).not.toContain("drop function");
    expect(procedureLintRepair).not.toContain("grant execute");
  });
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
    expect(productionCloseout).toContain("booking-credit-release:");
    expect(bookingCancellation).toContain("stripeIdempotencyPrefix");
    expect(publicBooking).toContain('stripeIdempotencyPrefix: "public-cancel"');
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
    expect(lessonRlsHotfix).toContain(
      "using (public.can_access_lesson(id, student_id, studio_id))",
    );
    expect(lessonRlsHotfix).not.toContain(
      "select 1 from public.lesson_participants lp",
    );
  });
  it("serializes confirmed private occurrences and builds course lessons", () => {
    expect(booking).toContain("lessons_private_overlap");
    expect(booking).toContain("pg_advisory_xact_lock");
    expect(booking).toContain("command_create_service_offering");
  });
  it("holds every recurring occurrence in one database transaction", () => {
    expect(booking).toContain("create_booking_series_holds");
    expect(booking).toContain("foreach occurrence_start");
    expect(compactPublicBooking).toContain("target_starts:occurrenceStarts");
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
    expect(compactPublicBooking).toContain("idempotencyKey:idempotency");
  });
  it("rate limits public catalog, availability, holds, and management commands", () => {
    expect(booking).toContain("claim_public_rate_limit");
    expect(booking).toContain("public_endpoint_rate_limits");
    expect(compactPublicBooking).toContain("rateLimit(request,action)");
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
    expect(compactPublicBooking).toContain(
      "Math.floor(totalMinor/billingCount)",
    );
    expect(stripeWebhook).toContain("Final installment rounding adjustment");
    expect(booking).toContain("installment_remainder_minor");
  });
  it("resumes pre-claimed package checkout webhooks without dropping the purchase", () => {
    expect(booking).toContain("prior_status='processed'");
    expect(booking).toContain("on conflict(id) do update");
    expect(booking).toContain("stripe-credit:");
  });

  it("does not consume the same lesson credit again when a reservation already exists", () => {
    expect(productionCloseout).toContain(
      "create or replace function public.command_complete_lesson",
    );
    expect(productionCloseout).toContain("package_credit_entries");
    expect(productionCloseout).toMatch(
      /not\s+exists[\s\S]{0,500}package_credit_entries[\s\S]{0,300}lesson_id\s*=\s*(?:target\.)?id[\s\S]{0,150}quantity\s*<\s*0/i,
    );
  });

  it("treats setup-mode Checkout as payment-method setup, not a package purchase", () => {
    const setupBranch = compactStripeWebhook.indexOf('object.mode==="setup"');
    const packageMetadata = compactStripeWebhook.indexOf(
      "conststudentId=object.metadata?.student_id",
    );
    expect(setupBranch).toBeGreaterThan(-1);
    expect(packageMetadata).toBeGreaterThan(setupBranch);
    expect(
      compactStripeWebhook.slice(setupBranch, packageMetadata),
    ).toContain("returndone(");
  });

  it("records Stripe refund webhooks idempotently by external reference", () => {
    const refundBranch = stripeWebhook.slice(
      stripeWebhook.indexOf('event.type === "charge.refunded"'),
    );
    const compactRefundBranch = refundBranch.replace(/\s+/g, "");
    expect(compactRefundBranch).toContain('.from("payment_entries").upsert(');
    expect(compactRefundBranch).toContain(
      'onConflict:"external_reference"',
    );
  });

  it("shows only future scheduled lessons as the student overview next lesson", () => {
    const overview = studentWorkspace.slice(
      studentWorkspace.indexOf("function Overview("),
    );
    expect(overview).toMatch(
      /item\.status\s*===\s*"scheduled"[\s\S]{0,250}(?:new Date\(item\.startsAt\)\.getTime\(\)|Date\.parse\(item\.startsAt\))[\s\S]{0,100}(?:Date\.now\(\)|now)/,
    );
  });

  it("keeps portal credentials server-managed and removes obsolete whiteboards", () => {
    expect(productionCloseout).toContain("create table if not exists public.portal_accounts");
    expect(productionCloseout).toContain("must_change_password");
    expect(productionCloseout).toContain("activity_type");
    expect(portalAccountHardening).toContain("revoke all on table public.portal_accounts from anon");
    expect(portalAccountHardening).toContain("grant select on table public.portal_accounts to authenticated");
    expect(portalAccountHardening).toContain("drop table if exists public.lesson_whiteboards cascade");
    expect(optionalBookingPortalInvites).toContain("portal_requested boolean not null default false");
    expect(publicBooking).toContain("portal_requested: input.createPortalProfile");
    expect(studentWorkspace).not.toContain("Temporary password");
    expect(studentWorkspace).not.toContain('command: "set_credentials"');
    expect(portalAccess).toContain('accountType: "student"');
    expect(portalAccess).toContain('accountType: "guardian"');
    expect(portalAccess).toContain('accountType: "minor_household"');
  });

  it("revokes and synchronizes linked-contact authorization transactionally", () => {
    expect(householdPackageHardening).toContain(
      "linked_contact_authorization_sync",
    );
    expect(householdPackageHardening).toContain(
      "delete from public.student_relationships",
    );
    expect(householdPackageHardening).toContain(
      "delete from public.portal_accounts",
    );
    expect(householdPackageHardening).toContain(
      "on conflict (student_id, user_id) do update",
    );
  });

  it("keeps balance renewals in flight and uses stable Stripe idempotency", () => {
    expect(householdPackageHardening).toContain(
      "renewal_in_flight = true",
    );
    expect(householdPackageHardening).not.toContain("interval '15 minutes'");
    expect(bookingMaintenance).toContain(
      "package-renewal:${renewal.id}:${attemptKey}:invoice",
    );
    expect(stripeWebhook).toContain("renewal_in_flight: false");
    expect(commandFunction).toContain(
      'input.command === "cancel_package_subscription"',
    );
    expect(studentPortal).toContain("Turn off renewal");
  });

  it("honors gift delivery dates and removes abandoned package checkouts", () => {
    expect(householdPackageHardening).toContain("gift.deliver_at > now()");
    expect(stripeWebhook).toContain("deliversLater");
    expect(bookingMaintenance).toContain("packageGiftsDelivered");
    expect(compactStripeWebhook).toContain(
      '.from("package_subscriptions").delete()',
    );
    expect(compactStripeWebhook).toContain('.from("packages").delete()');
  });

  it("sends an explicit null when a student removes a profile photo", () => {
    expect(studentPortal).toContain("profilePhotoAssetId = null");
  });
});
