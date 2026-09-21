import type { Config, Context } from "@netlify/functions";
import { createHash, timingSafeEqual } from "node:crypto";
import { findAuthUserByEmail } from "./_shared/auth-users";
import { json } from "./_shared/http";
import { serviceClient } from "./_shared/supabase";
import {
  assertE2ERunId,
  assertNonProductionE2EUrl,
  isProductionDeployContext,
} from "../../src/security/e2eSafety";
import type { Database } from "../../src/types/database.generated";

type RoleName = "coach" | "student" | "guardian" | "unrelated";
type TableName = keyof Database["public"]["Tables"];
type InsertRow<T extends TableName> = Database["public"]["Tables"][T]["Insert"];

const ids = [
  "coachStudent",
  "student",
  "unrelatedStudent",
  "guardianContact",
  "membership",
  "coachAccount",
  "studentAccount",
  "guardianAccount",
  "unrelatedAccount",
  "guardianRelationship",
  "conversation",
  "message",
  "assignment",
  "material",
  "packageDefinition",
  "package",
  "payment",
  "actorProfile",
  "actorRevision",
  "freeService",
  "paidService",
  "lessonNoLink",
  "lessonPending",
  "lessonAvailable",
  "lessonCancelled",
  "referredPending",
  "referredEarned",
  "referredRedeemed",
  "bookingPending",
  "bookingEarned",
  "bookingRedeemed",
  "referralPending",
  "referralEarned",
  "referralRedeemed",
  "discountEarned",
  "discountRedeemed",
  "rewardEarned",
  "rewardRedeemed",
] as const;

type FixtureIds = Record<(typeof ids)[number], string>;

function throwFixtureError(operation: string, error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "UNKNOWN";
  throw new Error(`E2E_FIXTURE_${operation.toUpperCase()}:${code}`, {
    cause: error,
  });
}

export function fixtureId(runId: string, label: string) {
  const hex = createHash("sha256").update(`${runId}:${label}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function fixtureIds(runId: string): FixtureIds {
  return Object.fromEntries(
    ids.map((label) => [label, fixtureId(runId, label)]),
  ) as FixtureIds;
}

function secretMatches(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function fixtureCredentials(runId: string, token: string) {
  const suffix = createHash("sha256").update(runId).digest("hex").slice(0, 8);
  const password = `E2e!${createHash("sha256").update(`${token}:${runId}`).digest("base64url").slice(0, 18)}`;
  return Object.fromEntries(
    (["coach", "student", "guardian", "unrelated"] as RoleName[]).map(
      (role) => [
        role,
        {
          username: `e2e.${role}.${suffix}`,
          email: `e2e-${role}-${suffix}@example.test`,
          password,
        },
      ],
    ),
  ) as Record<RoleName, { username: string; email: string; password: string }>;
}

async function resolveStudio() {
  const db = serviceClient();
  const configuredId =
    Netlify.env.get("E2E_STUDIO_ID") || Netlify.env.get("STUDIO_ID");
  const configuredSlug = Netlify.env.get("STUDIO_SLUG") || "stage-story";
  const query = db.from("studios").select("id,slug,name");
  const result = configuredId
    ? await query.eq("id", configuredId).single()
    : await query.eq("slug", configuredSlug).single();
  if (result.error || !result.data) throw new Error("E2E_STUDIO_UNAVAILABLE");
  return result.data;
}

async function removeAuthUsers(emails: string[]) {
  const db = serviceClient();
  for (const email of emails) {
    const user = await findAuthUserByEmail(db, email);
    if (user) {
      const { error } = await db.auth.admin.deleteUser(user.id);
      if (error) throwFixtureError("auth_user_delete", error);
    }
  }
}

async function cleanup(
  runId: string,
  studioId: string,
  fixture: FixtureIds,
  emails: string[],
) {
  assertE2ERunId(runId);
  const db = serviceClient();
  const { data: assets, error: assetError } = await db
    .from("file_assets")
    .select("id,storage_path")
    .eq("studio_id", studioId)
    .ilike("original_name", `${runId}-%`);
  if (assetError) throwFixtureError("asset_lookup", assetError);
  const storagePaths = (assets || []).map((asset) => asset.storage_path);
  if (storagePaths.length) {
    const { error } = await db.storage
      .from("studio-materials")
      .remove(storagePaths);
    if (error) throwFixtureError("storage_remove", error);
  }

  const deleteIds = async (table: string, values: string[]) => {
    const { error } = await db.from(table).delete().in("id", values);
    if (error) throwFixtureError(`delete_${table}`, error);
  };

  if (assets?.length)
    await deleteIds(
      "file_assets",
      assets.map((asset) => asset.id),
    );
  const { error: materialError } = await db
    .from("materials")
    .delete()
    .eq("studio_id", studioId)
    .ilike("title", `${runId}%`);
  if (materialError) throwFixtureError("material_cleanup", materialError);

  await deleteIds("referral_rewards", [
    fixture.rewardEarned,
    fixture.rewardRedeemed,
  ]);
  await deleteIds("referrals", [
    fixture.referralPending,
    fixture.referralEarned,
    fixture.referralRedeemed,
  ]);
  await deleteIds("bookings", [
    fixture.bookingPending,
    fixture.bookingEarned,
    fixture.bookingRedeemed,
  ]);
  await deleteIds("discount_codes", [
    fixture.discountEarned,
    fixture.discountRedeemed,
  ]);
  const { error: messageError } = await db
    .from("conversation_messages")
    .delete()
    .eq("conversation_id", fixture.conversation);
  if (messageError) throwFixtureError("message_cleanup", messageError);
  await deleteIds("conversations", [fixture.conversation]);
  await deleteIds("payment_entries", [fixture.payment]);
  await deleteIds("packages", [fixture.package]);
  await deleteIds("package_definitions", [fixture.packageDefinition]);
  const { error: detachRevisionError } = await db
    .from("actor_profiles")
    .update({ published_revision_id: null })
    .eq("id", fixture.actorProfile);
  if (detachRevisionError)
    throwFixtureError("actor_revision_detach", detachRevisionError);
  await deleteIds("actor_profile_revisions", [fixture.actorRevision]);
  await deleteIds("actor_profiles", [fixture.actorProfile]);
  await deleteIds("assignments", [fixture.assignment]);
  await deleteIds("materials", [fixture.material]);
  await deleteIds("lessons", [
    fixture.lessonNoLink,
    fixture.lessonPending,
    fixture.lessonAvailable,
    fixture.lessonCancelled,
  ]);
  await deleteIds("booking_services", [
    fixture.freeService,
    fixture.paidService,
  ]);
  await deleteIds("student_relationships", [fixture.guardianRelationship]);
  await deleteIds("portal_accounts", [
    fixture.coachAccount,
    fixture.studentAccount,
    fixture.guardianAccount,
    fixture.unrelatedAccount,
  ]);
  await deleteIds("linked_contacts", [fixture.guardianContact]);
  await deleteIds("memberships", [fixture.membership]);
  await deleteIds("students", [
    fixture.coachStudent,
    fixture.student,
    fixture.unrelatedStudent,
    fixture.referredPending,
    fixture.referredEarned,
    fixture.referredRedeemed,
  ]);
  await removeAuthUsers(emails);
}

async function upsertAuthUser(
  email: string,
  password: string,
  displayName: string,
) {
  const db = serviceClient();
  const existing = await findAuthUserByEmail(db, email);
  if (existing) {
    const { data, error } = await db.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName, e2e: true },
    });
    if (error) throwFixtureError("auth_user_update", error);
    return data.user;
  }
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName, e2e: true },
  });
  if (error) throwFixtureError("auth_user_create", error);
  return data.user;
}

async function setup(
  runId: string,
  studioId: string,
  fixture: FixtureIds,
  token: string,
) {
  const db = serviceClient();
  const accounts = fixtureCredentials(runId, token);
  await cleanup(
    runId,
    studioId,
    fixture,
    Object.values(accounts).map((item) => item.email),
  );
  const users = {
    coach: await upsertAuthUser(
      accounts.coach.email,
      accounts.coach.password,
      "E2E Coach",
    ),
    student: await upsertAuthUser(
      accounts.student.email,
      accounts.student.password,
      "E2E Student",
    ),
    guardian: await upsertAuthUser(
      accounts.guardian.email,
      accounts.guardian.password,
      "E2E Guardian",
    ),
    unrelated: await upsertAuthUser(
      accounts.unrelated.email,
      accounts.unrelated.password,
      "E2E Unrelated Student",
    ),
  };
  const now = Date.now();
  const iso = (minutes: number) =>
    new Date(now + minutes * 60_000).toISOString();
  const studentRows = [
    {
      id: fixture.coachStudent,
      studio_id: studioId,
      user_id: users.coach.id,
      full_name: `${runId} Coach Account`,
      preferred_name: "Coach",
      email: accounts.coach.email,
      portal_enabled: true,
      portal_username: accounts.coach.username,
      referral_code: `E2ECOACH${runId.slice(-4).toUpperCase()}`,
      status: "active",
    },
    {
      id: fixture.student,
      studio_id: studioId,
      user_id: users.student.id,
      full_name: `${runId} Student`,
      preferred_name: "E2E Student",
      email: accounts.student.email,
      guardian_name: "E2E Guardian",
      guardian_email: accounts.guardian.email,
      portal_enabled: true,
      portal_username: accounts.student.username,
      referral_code: `E2ESTUDENT${runId.slice(-4).toUpperCase()}`,
      actor_page_eligible: true,
      status: "active",
    },
    {
      id: fixture.unrelatedStudent,
      studio_id: studioId,
      user_id: users.unrelated.id,
      full_name: `${runId} Unrelated`,
      preferred_name: "Unrelated",
      email: accounts.unrelated.email,
      portal_enabled: true,
      portal_username: accounts.unrelated.username,
      referral_code: `E2EOTHER${runId.slice(-4).toUpperCase()}`,
      status: "active",
    },
    ...(["Pending", "Earned", "Redeemed"] as const).map((label) => ({
      id: fixture[`referred${label}`],
      studio_id: studioId,
      full_name: `${runId} Referred ${label}`,
      email: `e2e-referred-${label.toLowerCase()}-${runId.slice(-8)}@example.test`,
      portal_enabled: false,
      referral_code: `E2E${label.toUpperCase()}${runId.slice(-4).toUpperCase()}`,
      status: "active" as const,
    })),
  ] satisfies InsertRow<"students">[];
  const { error: studentsError } = await db
    .from("students")
    .upsert(studentRows, { defaultToNull: false });
  if (studentsError) throwFixtureError("students", studentsError);

  const { error: membershipError } = await db.from("memberships").upsert({
    id: fixture.membership,
    studio_id: studioId,
    user_id: users.coach.id,
    display_name: "E2E Coach",
    role: "coach",
  });
  if (membershipError) throwFixtureError("membership", membershipError);

  const { error: contactError } = await db.from("linked_contacts").upsert({
    id: fixture.guardianContact,
    studio_id: studioId,
    student_id: fixture.student,
    user_id: users.guardian.id,
    full_name: "E2E Guardian",
    email: accounts.guardian.email,
    relationship_type: "guardian",
    relationship_label: "Guardian",
    portal_enabled: true,
    can_view_finance: true,
    can_view_schedule: true,
    can_view_work: true,
    can_manage_profile: true,
    can_manage_lessons: true,
  });
  if (contactError) throwFixtureError("linked_contact", contactError);
  const { error: relationshipError } = await db
    .from("student_relationships")
    .upsert({
      id: fixture.guardianRelationship,
      student_id: fixture.student,
      user_id: users.guardian.id,
      linked_contact_id: fixture.guardianContact,
      relationship: "guardian",
      can_view_finance: true,
      can_view_schedule: true,
      can_view_work: true,
      can_manage_profile: true,
      can_manage_lessons: true,
    });
  if (relationshipError)
    throwFixtureError("student_relationship", relationshipError);

  const portalRows = [
    {
      id: fixture.coachAccount,
      studio_id: studioId,
      student_id: fixture.coachStudent,
      user_id: users.coach.id,
      account_type: "student",
      username: accounts.coach.username,
      email: accounts.coach.email,
    },
    {
      id: fixture.studentAccount,
      studio_id: studioId,
      student_id: fixture.student,
      user_id: users.student.id,
      account_type: "student",
      username: accounts.student.username,
      email: accounts.student.email,
    },
    {
      id: fixture.guardianAccount,
      studio_id: studioId,
      student_id: fixture.student,
      linked_contact_id: fixture.guardianContact,
      user_id: users.guardian.id,
      account_type: "guardian",
      username: accounts.guardian.username,
      email: accounts.guardian.email,
    },
    {
      id: fixture.unrelatedAccount,
      studio_id: studioId,
      student_id: fixture.unrelatedStudent,
      user_id: users.unrelated.id,
      account_type: "student",
      username: accounts.unrelated.username,
      email: accounts.unrelated.email,
    },
  ] satisfies InsertRow<"portal_accounts">[];
  const { error: portalError } = await db
    .from("portal_accounts")
    .upsert(portalRows);
  if (portalError) throwFixtureError("portal_accounts", portalError);

  const services = [
    {
      id: fixture.freeService,
      studio_id: studioId,
      slug: `${runId}-free-introduction`,
      name: `${runId} Free introduction`,
      description: "Deterministic E2E free booking service",
      category: "private",
      duration_minutes: 30,
      price_minor: 0,
      deposit_minor: 0,
      deposit_type: "full",
      capacity: 1,
      default_location: "online",
      location_options: ["online"],
      minimum_notice_hours: 0,
      booking_horizon_days: 90,
      published: true,
    },
    {
      id: fixture.paidService,
      studio_id: studioId,
      slug: `${runId}-paid-coaching`,
      name: `${runId} Paid coaching`,
      description: "Deterministic E2E paid booking service",
      category: "private",
      duration_minutes: 60,
      price_minor: 7500,
      deposit_minor: 2500,
      deposit_type: "fixed",
      capacity: 1,
      default_location: "online",
      location_options: ["online", "in_person"],
      location_price_adjustments: { in_person: 1500 },
      minimum_notice_hours: 0,
      booking_horizon_days: 90,
      published: true,
    },
  ] satisfies InsertRow<"booking_services">[];
  const { error: serviceError } = await db
    .from("booking_services")
    .upsert(services, { defaultToNull: false });
  if (serviceError) throwFixtureError("booking_services", serviceError);

  const lessonBase = {
    studio_id: studioId,
    student_id: fixture.student,
    location_label: "Google Meet",
    location_type: "online",
    meeting_provider: "google_meet",
    source_provider: "manual",
    payment_status: "paid",
    price_minor: 7500,
    paid_minor: 7500,
  } satisfies Omit<
    InsertRow<"lessons">,
    "id" | "topic" | "starts_at" | "ends_at" | "status" | "join_url"
  >;
  const { error: lessonsError } = await db.from("lessons").upsert([
    {
      ...lessonBase,
      id: fixture.lessonNoLink,
      topic: `${runId} No meeting link`,
      starts_at: iso(2880),
      ends_at: iso(2940),
      status: "scheduled",
      join_url: null,
    },
    {
      ...lessonBase,
      id: fixture.lessonPending,
      topic: `${runId} Meet pending`,
      starts_at: iso(4320),
      ends_at: iso(4380),
      status: "scheduled",
      join_url: null,
    },
    {
      ...lessonBase,
      id: fixture.lessonAvailable,
      topic: `${runId} Meet available`,
      starts_at: iso(10),
      ends_at: iso(70),
      status: "scheduled",
      join_url: "https://meet.google.com/e2e-safe-fixture",
    },
    {
      ...lessonBase,
      id: fixture.lessonCancelled,
      topic: `${runId} Cancelled lesson`,
      starts_at: iso(-1440),
      ends_at: iso(-1380),
      status: "cancelled",
      join_url: null,
    },
  ]);
  if (lessonsError) throwFixtureError("lessons", lessonsError);

  const { error: assignmentError } = await db.from("assignments").upsert({
    id: fixture.assignment,
    student_id: fixture.student,
    lesson_id: fixture.lessonPending,
    title: `${runId} Current work`,
    details: "Deterministic assignment visible only to the fixture household.",
    category: "Practice",
    status: "assigned",
    due_at: iso(5760),
  });
  if (assignmentError) throwFixtureError("assignment", assignmentError);
  const { error: materialError } = await db.from("materials").upsert({
    id: fixture.material,
    studio_id: studioId,
    owner_student_id: fixture.student,
    title: `${runId} Fixture material`,
    caption: "Safe non-private E2E material",
    category: "Script",
    external_url: "https://example.com/e2e-fixture",
    media_kind: "link",
    status: "active",
    approval_status: "not_public",
  });
  if (materialError) throwFixtureError("material", materialError);

  const { error: packageDefinitionError } = await db
    .from("package_definitions")
    .upsert({
      id: fixture.packageDefinition,
      studio_id: studioId,
      name: `${runId} Four-session package`,
      description: "E2E payment fixture",
      session_count: 4,
      session_duration_minutes: 60,
      price_minor: 28000,
      visibility: "public",
      active: true,
      direct_purchase: true,
      eligible_service_ids: [fixture.paidService],
    });
  if (packageDefinitionError)
    throwFixtureError("package_definition", packageDefinitionError);
  const { error: packageError } = await db.from("packages").upsert({
    id: fixture.package,
    student_id: fixture.student,
    definition_id: fixture.packageDefinition,
    name: `${runId} Four-session package`,
    credit_quantity: 4,
    price_minor: 28000,
    auto_apply: true,
    expires_at: iso(60 * 24 * 90),
  });
  if (packageError) throwFixtureError("package", packageError);
  const { error: paymentError } = await db.from("payment_entries").upsert({
    id: fixture.payment,
    student_id: fixture.student,
    package_id: fixture.package,
    amount_minor: 28000,
    kind: "payment",
    reason: `${runId} fixture payment`,
  });
  if (paymentError) throwFixtureError("payment", paymentError);

  const actorContent = {
    headline: "E2E Actor",
    bio: "Published deterministic actor profile.",
    location: "New York, NY",
    sections: [],
  };
  const { error: profileError } = await db.from("actor_profiles").upsert({
    id: fixture.actorProfile,
    student_id: fixture.student,
    display_name: "E2E Actor",
    slug: `${runId}-actor`,
    bio: "Published deterministic actor profile.",
    draft_content: actorContent,
    status: "published",
    published_revision_id: null,
  });
  if (profileError) throwFixtureError("actor_profile", profileError);
  const { error: revisionError } = await db
    .from("actor_profile_revisions")
    .upsert({
      id: fixture.actorRevision,
      actor_profile_id: fixture.actorProfile,
      revision_number: 1,
      content: actorContent,
    });
  if (revisionError) throwFixtureError("actor_revision", revisionError);
  const { error: publishError } = await db
    .from("actor_profiles")
    .update({ published_revision_id: fixture.actorRevision })
    .eq("id", fixture.actorProfile);
  if (publishError) throwFixtureError("actor_publish", publishError);

  const { error: conversationError } = await db.from("conversations").upsert({
    id: fixture.conversation,
    studio_id: studioId,
    student_id: fixture.student,
    kind: "household",
    title: "E2E Coach conversation",
    last_message_at: iso(-30),
  });
  if (conversationError) throwFixtureError("conversation", conversationError);
  const { error: messageError } = await db
    .from("conversation_messages")
    .upsert({
      id: fixture.message,
      studio_id: studioId,
      conversation_id: fixture.conversation,
      author_user_id: users.coach.id,
      author_role: "coach",
      author_name: "E2E Coach",
      body: `${runId} fixture welcome message`,
      created_at: iso(-30),
    });
  if (messageError) throwFixtureError("message", messageError);

  const referred = [
    fixture.referredPending,
    fixture.referredEarned,
    fixture.referredRedeemed,
  ];
  const bookingIds = [
    fixture.bookingPending,
    fixture.bookingEarned,
    fixture.bookingRedeemed,
  ];
  const bookingRows = bookingIds.map((id, index) => ({
    id,
    studio_id: studioId,
    service_id: fixture.paidService,
    student_id: referred[index],
    reference: `${runId.toUpperCase()}-${index + 1}`,
    guest_name: `${runId} Referred ${index + 1}`,
    guest_email: `e2e-referral-${index + 1}-${runId.slice(-8)}@example.test`,
    starts_at: iso(10080 + index * 1440),
    ends_at: iso(10140 + index * 1440),
    timezone: "America/New_York",
    location: "online",
    status: "confirmed",
    payment_policy: "pay_now",
    payment_status: index === 0 ? "due" : "paid",
    total_minor: 7500,
    paid_minor: index === 0 ? 0 : 7500,
    policy_snapshot: {},
    pricing_snapshot: {},
    manage_token_hash: createHash("sha256")
      .update(`${runId}:${id}`)
      .digest("hex"),
  })) satisfies InsertRow<"bookings">[];
  const { error: bookingError } = await db.from("bookings").upsert(bookingRows);
  if (bookingError) throwFixtureError("bookings", bookingError);
  const referralRows = [
    fixture.referralPending,
    fixture.referralEarned,
    fixture.referralRedeemed,
  ].map((id, index) => ({
    id,
    studio_id: studioId,
    referrer_student_id: fixture.student,
    referred_student_id: referred[index],
    referred_email: bookingRows[index].guest_email,
    source_booking_id: bookingIds[index],
  })) satisfies InsertRow<"referrals">[];
  const { error: referralError } = await db
    .from("referrals")
    .upsert(referralRows);
  if (referralError) throwFixtureError("referrals", referralError);
  const discountRows = [
    {
      id: fixture.discountEarned,
      studio_id: studioId,
      code: `E2E-EARNED-${runId.slice(-6).toUpperCase()}`,
      description: `${runId} earned referral`,
      discount_type: "fixed",
      amount: 1500,
      restricted_student_id: fixture.student,
      referral_reward_kind: "paid_lesson",
      redemption_count: 0,
    },
    {
      id: fixture.discountRedeemed,
      studio_id: studioId,
      code: `E2E-USED-${runId.slice(-6).toUpperCase()}`,
      description: `${runId} redeemed referral`,
      discount_type: "fixed",
      amount: 1500,
      restricted_student_id: fixture.student,
      referral_reward_kind: "paid_lesson",
      redemption_count: 1,
    },
  ] satisfies InsertRow<"discount_codes">[];
  const { error: discountError } = await db
    .from("discount_codes")
    .upsert(discountRows);
  if (discountError) throwFixtureError("discounts", discountError);
  const { error: rewardsError } = await db.from("referral_rewards").upsert([
    {
      id: fixture.rewardEarned,
      referral_id: fixture.referralEarned,
      discount_code_id: fixture.discountEarned,
      earned_booking_id: fixture.bookingEarned,
      kind: "paid_lesson",
    },
    {
      id: fixture.rewardRedeemed,
      referral_id: fixture.referralRedeemed,
      discount_code_id: fixture.discountRedeemed,
      earned_booking_id: fixture.bookingRedeemed,
      kind: "paid_lesson",
    },
  ]);
  if (rewardsError) throwFixtureError("referral_rewards", rewardsError);

  return {
    accounts,
    ids: fixture,
    actorSlug: `${runId}-actor`,
    capabilities: {
      google: Boolean(Netlify.env.get("GOOGLE_REFRESH_TOKEN")),
      stripeTest: (Netlify.env.get("STRIPE_SECRET_KEY") || "").startsWith(
        "sk_test_",
      ),
    },
  };
}

export default async (request: Request, context: Context) => {
  try {
    assertNonProductionE2EUrl(request.url);
    if (isProductionDeployContext(Netlify.env.get("CONTEXT"))) {
      return json({ message: "E2E fixtures are disabled in production." }, 403);
    }
    if (request.method !== "POST")
      return json({ message: "Method not allowed." }, 405);
    const expectedToken = Netlify.env.get("E2E_FIXTURE_TOKEN") || "";
    const suppliedToken = request.headers.get("x-e2e-fixture-token") || "";
    if (!expectedToken || !secretMatches(suppliedToken, expectedToken)) {
      return json({ message: "Fixture authorization failed." }, 401);
    }
    const body = (await request.json()) as { action?: string; runId?: string };
    const runId = assertE2ERunId(String(body.runId || ""));
    const studio = await resolveStudio();
    const fixture = fixtureIds(runId);
    const accountSet = fixtureCredentials(runId, expectedToken);
    if (body.action === "cleanup") {
      await cleanup(
        runId,
        studio.id,
        fixture,
        Object.values(accountSet).map((item) => item.email),
      );
      return json({ ok: true, runId });
    }
    if (body.action !== "setup")
      return json({ message: "Unknown fixture action." }, 400);
    return json(
      {
        ok: true,
        runId,
        studio,
        ...(await setup(runId, studio.id, fixture, expectedToken)),
      },
      201,
      { "Cache-Control": "no-store" },
    );
  } catch (error) {
    console.error("E2E fixture operation failed", {
      requestId: context.requestId,
      error,
    });
    return json(
      {
        message:
          error instanceof Error ? error.message : "Fixture operation failed.",
      },
      500,
      { "Cache-Control": "no-store" },
    );
  }
};

export const config: Config = { path: "/api/e2e/fixtures" };
