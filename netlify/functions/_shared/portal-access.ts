import type { SupabaseClient } from "@supabase/supabase-js";

export async function ensureBookingPortalAccess(db: SupabaseClient, bookingId: string, origin: string) {
  const { data: booking, error } = await db.from("bookings").select("id,studio_id,student_id,guest_email,guardian_email,for_minor").eq("id", bookingId).single();
  if (error || !booking?.student_id) throw error || new Error("Booking has no linked student.");
  const { data: student } = await db.from("students").select("id,user_id").eq("id", booking.student_id).single();
  if (!student) throw new Error("Booking student is unavailable.");
  const email = String(booking.for_minor ? booking.guardian_email : booking.guest_email).toLowerCase();
  if (!email) throw new Error("Portal invitation email is missing.");
  let userId = booking.for_minor ? undefined : student.user_id as string | undefined;
  if (!userId) {
    const { data: invite, error: inviteError } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: `${origin}/portal` });
    userId = invite.user?.id;
    if (inviteError && !String(inviteError.message).toLowerCase().includes("already")) throw inviteError;
    if (!userId) {
      const { data: users, error: usersError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (usersError) throw usersError;
      userId = users.users.find((user) => user.email?.toLowerCase() === email)?.id;
    }
  }
  if (!userId) throw new Error("Portal identity could not be linked.");
  if (booking.for_minor) {
    const { error: relationshipError } = await db.from("student_relationships").upsert({ student_id: student.id, user_id: userId, relationship: "guardian", can_view_finance: true, can_manage_profile: true }, { onConflict: "student_id,user_id" });
    if (relationshipError) throw relationshipError;
  } else if (!student.user_id) {
    const { error: studentError } = await db.from("students").update({ user_id: userId, portal_enabled: true, updated_at: new Date().toISOString() }).eq("id", student.id);
    if (studentError) throw studentError;
  }
  return { userId, email };
}
