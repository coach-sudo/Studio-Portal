import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationCategory = "lessonReminders" | "scheduleChanges" | "lessonContent" | "assignments" | "packageBalance" | "payments" | "accountAccess";

const enabled = (preferences: Record<string, unknown> | null | undefined, category: NotificationCategory, fallback = true) =>
  typeof preferences?.[category] === "boolean" ? Boolean(preferences[category]) : fallback;

export async function resolveNotificationRecipients(
  db: SupabaseClient,
  studentId: string,
  category: NotificationCategory,
  options: { mandatory?: boolean; financeOnly?: boolean } = {},
) {
  const [{ data: student, error: studentError }, { data: contacts, error: contactError }] = await Promise.all([
    db.from("students").select("email,is_minor,notification_preferences").eq("id", studentId).single(),
    db.from("linked_contacts").select("email,can_view_finance,can_receive_notifications,notification_preferences").eq("student_id", studentId).eq("portal_enabled", true),
  ]);
  if (studentError) throw studentError;
  if (contactError) throw contactError;
  const recipients = new Set<string>();
  const studentMayReceiveFinance = !student.is_minor;
  if (student.email && (!options.financeOnly || studentMayReceiveFinance) && (options.mandatory || enabled(student.notification_preferences, category)))
    recipients.add(String(student.email).trim().toLowerCase());
  for (const contact of contacts || []) {
    if (!contact.email || !contact.can_receive_notifications) continue;
    if (options.financeOnly && !contact.can_view_finance) continue;
    if (options.mandatory || enabled(contact.notification_preferences, category))
      recipients.add(String(contact.email).trim().toLowerCase());
  }
  return [...recipients];
}
