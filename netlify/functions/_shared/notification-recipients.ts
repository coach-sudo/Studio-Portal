import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.generated";
import type {
  LinkedContact,
  NotificationPreferences,
  Student,
} from "../../../src/domain/model";
import {
  resolveNotificationRecipients as resolvePolicy,
  type RecipientIntent,
} from "../../../src/domain/notificationRecipients";

export type NotificationCategory = keyof NotificationPreferences;

export async function notificationRecipientContext(
  client: SupabaseClient,
  studentId: string,
) {
  const db = client as SupabaseClient<Database>;
  const [
    { data: row, error: studentError },
    { data: contacts, error: contactError },
  ] = await Promise.all([
    db.from("students").select("*").eq("id", studentId).single(),
    db.from("linked_contacts").select("*").eq("student_id", studentId),
  ]);
  if (studentError) throw studentError;
  if (contactError) throw contactError;
  const preferences = (value: unknown) =>
    value as NotificationPreferences | undefined;
  const student: Student = {
    id: row.id,
    studioId: row.studio_id,
    fullName: row.full_name,
    email: row.email ?? undefined,
    isMinor: row.is_minor,
    status: row.status,
    portalEnabled: row.portal_enabled,
    actorPageEligible: row.actor_page_eligible,
    notificationPreferences: preferences(row.notification_preferences),
    version: row.version,
    updatedAt: row.updated_at,
  };
  const linked: LinkedContact[] = (contacts ?? []).map((contact) => ({
    id: contact.id,
    studentId: contact.student_id,
    studioId: contact.studio_id,
    fullName: contact.full_name,
    email: contact.email,
    relationshipType:
      contact.relationship_type as LinkedContact["relationshipType"],
    portalEnabled: contact.portal_enabled,
    canViewFinance: contact.can_view_finance,
    canViewWork: contact.can_view_work,
    canViewSchedule: contact.can_view_schedule,
    canManageLessons: contact.can_manage_lessons,
    canManageProfile: contact.can_manage_profile,
    canReceiveNotifications: contact.can_receive_notifications,
    isPrimaryPayer: contact.is_primary_payer,
    isPrimarySchedulingContact: contact.is_primary_scheduling_contact,
    receivesFinancialEscalations: contact.receives_financial_escalations,
    notificationPreferences:
      preferences(contact.notification_preferences) ??
      ({} as NotificationPreferences),
    version: contact.version,
    updatedAt: contact.updated_at,
  }));
  return { student, contacts: linked };
}

export async function resolveEventRecipients(
  db: SupabaseClient,
  studentId: string,
  intent: RecipientIntent,
  options: { mandatory?: boolean } = {},
) {
  const context = await notificationRecipientContext(db, studentId);
  return resolvePolicy(context.student, context.contacts, intent, options);
}

/** Category compatibility for existing producers, using the same permissions/payer policy. */
export async function resolveNotificationRecipients(
  db: SupabaseClient,
  studentId: string,
  category: NotificationCategory,
  options: { mandatory?: boolean; financeOnly?: boolean } = {},
) {
  const intents: Record<NotificationCategory, RecipientIntent> = {
    lessonReminders: "lesson_reminder",
    scheduleChanges: "schedule_change",
    lessonContent: "lesson_content",
    assignments: "assignment",
    packageBalance: "package_low",
    payments: "payment_due",
    accountAccess: "account_access",
  };
  const resolution = await resolveEventRecipients(
    db,
    studentId,
    intents[category],
    options,
  );
  return resolution.recipients.map((recipient) => recipient.email);
}
