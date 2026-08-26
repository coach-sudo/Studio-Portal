import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findAuthUserByEmail } from "./auth-users";

type AccountType = "student" | "guardian";
type StudentIdentity = {
  id: string;
  studio_id: string;
  full_name: string;
  preferred_name?: string | null;
  email?: string | null;
  guardian_email?: string | null;
  is_minor: boolean;
  user_id?: string | null;
  portal_username?: string | null;
  version: number;
};

const usernameBase = (name: string, accountType: AccountType) => {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
  const base = /^[a-z]/.test(normalized) ? normalized : `actor.${normalized}`;
  return `${base || "student"}${accountType === "guardian" ? ".guardian" : ""}`.slice(
    0,
    28,
  );
};

export const generateTemporaryPassword = () =>
  `P!${randomBytes(12).toString("base64url")}a7`;

async function availableUsername(
  db: SupabaseClient,
  base: string,
  currentAccountId?: string,
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt ? `.${attempt + 1}` : "";
    const username = `${base.slice(0, 32 - suffix.length)}${suffix}`;
    const { data, error } = await db
      .from("portal_accounts")
      .select("id")
      .ilike("username", username)
      .maybeSingle();
    if (error) throw error;
    if (!data || data.id === currentAccountId) return username;
  }
  throw new Error("Portal username could not be generated.");
}

export async function provisionPortalAccount(
  db: SupabaseClient,
  options: {
    studioId: string;
    studentId: string;
    accountType: AccountType;
    resetExisting: boolean;
    expectedVersion?: number;
  },
) {
  const [{ data: student, error: studentError }, { data: studio }] =
    await Promise.all([
      db
        .from("students")
        .select(
          "id,studio_id,full_name,preferred_name,email,guardian_email,is_minor,user_id,portal_username,version",
        )
        .eq("id", options.studentId)
        .eq("studio_id", options.studioId)
        .single(),
      db.from("studios").select("name").eq("id", options.studioId).single(),
    ]);
  if (studentError || !student)
    throw studentError || new Error("Student not found.");
  const identity = student as StudentIdentity;
  if (
    options.expectedVersion !== undefined &&
    identity.version !== options.expectedVersion
  )
    throw new Error(`VERSION_CONFLICT:${options.expectedVersion}`);
  if (options.accountType === "guardian" && !identity.is_minor)
    throw new Error(
      "VALIDATION_FAILED: Guardian access is only available for a minor student.",
    );
  const email = String(
    options.accountType === "guardian"
      ? identity.guardian_email
      : identity.email,
  )
    .trim()
    .toLowerCase();
  if (!email.includes("@"))
    throw new Error(
      `VALIDATION_FAILED: Add the ${options.accountType} email first.`,
    );

  const { data: currentAccount, error: accountReadError } = await db
    .from("portal_accounts")
    .select("id,user_id,username,email")
    .eq("student_id", identity.id)
    .eq("account_type", options.accountType)
    .maybeSingle();
  if (accountReadError) throw accountReadError;
  if (currentAccount && !options.resetExisting)
    return {
      accountType: options.accountType,
      recipient: currentAccount.email,
      username: currentAccount.username,
      instructionsQueued: false,
      alreadyExisted: true,
      student: identity,
    };

  let linkedToStudent = Boolean(currentAccount?.user_id);
  let authUser = currentAccount?.user_id
    ? { id: currentAccount.user_id }
    : options.accountType === "student" && identity.user_id
      ? { id: identity.user_id }
      : undefined;
  if (options.accountType === "student" && identity.user_id)
    linkedToStudent = true;
  if (!authUser && options.accountType === "guardian") {
    const { data: relationship, error: relationshipReadError } = await db
      .from("student_relationships")
      .select("user_id")
      .eq("student_id", identity.id)
      .eq("relationship", "guardian")
      .limit(1)
      .maybeSingle();
    if (relationshipReadError) throw relationshipReadError;
    if (relationship?.user_id) {
      authUser = { id: relationship.user_id };
      linkedToStudent = true;
    }
  }
  if (!authUser) {
    const existingIdentity = await findAuthUserByEmail(db, email);
    if (
      existingIdentity &&
      existingIdentity.user_metadata?.student_id !== identity.id
    )
      throw new Error(
        "EMAIL_ALREADY_IN_USE: This email already belongs to another studio account. Link or merge that account before sending a new invitation.",
      );
    authUser = existingIdentity;
    linkedToStudent = Boolean(existingIdentity);
  }

  if (authUser && !linkedToStudent)
    throw new Error(
      "EMAIL_ALREADY_IN_USE: This email already belongs to another studio account. Link or merge that account before sending a new invitation.",
    );

  const temporaryPassword = generateTemporaryPassword();
  const metadata = {
    portal_role: options.accountType,
    must_change_password: true,
    student_id: identity.id,
  };
  if (authUser) {
    const { error } = await db.auth.admin.updateUserById(authUser.id, {
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: metadata,
    });
    if (error) throw error;
  } else {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: metadata,
    });
    if (error || !data.user)
      throw error || new Error("Portal identity could not be created.");
    authUser = data.user;
  }

  const username =
    currentAccount?.username ||
    (await availableUsername(
      db,
      usernameBase(
        identity.preferred_name || identity.full_name,
        options.accountType,
      ),
      currentAccount?.id,
    ));
  if (options.accountType === "guardian") {
    const { error } = await db.from("student_relationships").upsert(
      {
        student_id: identity.id,
        user_id: authUser.id,
        relationship: "guardian",
        can_view_finance: true,
        can_manage_profile: true,
      },
      { onConflict: "student_id,user_id" },
    );
    if (error) throw error;
  }

  const queuedAt = new Date().toISOString();
  const { data: account, error: accountWriteError } = await db
    .from("portal_accounts")
    .upsert(
      {
        studio_id: options.studioId,
        student_id: identity.id,
        user_id: authUser.id,
        account_type: options.accountType,
        username,
        email,
        must_change_password: true,
        instructions_sent_at: queuedAt,
        updated_at: queuedAt,
      },
      { onConflict: "student_id,account_type" },
    )
    .select("id")
    .single();
  if (accountWriteError || !account)
    throw accountWriteError || new Error("Portal account could not be saved.");

  const { data: updatedStudent, error: updateError } = await db
    .from("students")
    .update({
      user_id:
        options.accountType === "student" ? authUser.id : identity.user_id,
      portal_username:
        options.accountType === "student"
          ? username
          : identity.portal_username,
      portal_enabled: true,
      version: identity.version + 1,
      updated_at: queuedAt,
    })
    .eq("id", identity.id)
    .eq("version", identity.version)
    .select()
    .single();
  if (updateError) throw updateError;

  const loginUrl = `${Netlify.env.get("URL") || "https://portal.d-a-j.com"}/login`;
  const studioName = studio?.name || "Coach'D";
  const { error: queueError } = await db.from("outbox_messages").insert({
    studio_id: options.studioId,
    student_id: identity.id,
    channel: "email",
    recipient: email,
    subject: `Your ${studioName} portal login`,
    body: [
      "Hello,",
      "",
      `Your ${options.accountType} portal for ${identity.preferred_name || identity.full_name} is ready.`,
      "",
      `Sign in: ${loginUrl}`,
      `Username: ${username}`,
      `Temporary password: ${temporaryPassword}`,
      "",
      "This temporary password is only for your first sign-in. You will immediately be asked to create a private password.",
      "Your coach cannot see the private password you create.",
      "If you need help, contact the studio instead of forwarding this email.",
    ].join("\n"),
    status: "queued",
    send_at: queuedAt,
    event_key: "portal.credentials",
    dedupe_key: `portal-credentials:${account.id}:${Date.now()}`,
  });
  if (queueError) throw queueError;

  return {
    accountType: options.accountType,
    recipient: email,
    username,
    instructionsQueued: true,
    alreadyExisted: Boolean(currentAccount),
    student: updatedStudent,
  };
}

export async function ensureBookingPortalAccess(
  db: SupabaseClient,
  bookingId: string,
  _origin: string,
) {
  const { data: booking, error } = await db
    .from("bookings")
    .select("id,studio_id,student_id,for_minor,portal_requested")
    .eq("id", bookingId)
    .single();
  if (error || !booking?.student_id)
    throw error || new Error("Booking has no linked student.");
  if (!booking.portal_requested)
    return { skipped: true, instructionsQueued: false };
  const studentAccount = await provisionPortalAccount(db, {
    studioId: booking.studio_id,
    studentId: booking.student_id,
    accountType: "student",
    resetExisting: false,
  });
  if (!booking.for_minor) return studentAccount;
  const guardianAccount = await provisionPortalAccount(db, {
    studioId: booking.studio_id,
    studentId: booking.student_id,
    accountType: "guardian",
    resetExisting: false,
  });
  return {
    accountType: "minor_household",
    instructionsQueued:
      studentAccount.instructionsQueued || guardianAccount.instructionsQueued,
    accounts: [studentAccount, guardianAccount],
  };
}
