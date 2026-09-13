import type { Config } from "@netlify/functions";
import { apiError, json } from "./_shared/http";
import { serviceClient, userClient } from "./_shared/supabase";

export default async (request: Request) => {
  try {
    if (request.method !== "GET")
      return json({ message: "Method not allowed." }, 405);
    if (!request.headers.get("authorization")?.startsWith("Bearer "))
      return json({ message: "Sign in to view referrals." }, 401);
    const user = userClient(request);
    const { data: auth, error: authError } = await user.auth.getUser();
    if (authError || !auth.user) throw new Error("FORBIDDEN");
    const { data: membership, error: membershipError } = await user
      .from("memberships")
      .select("studio_id")
      .eq("role", "coach")
      .limit(1)
      .maybeSingle();
    if (membershipError) throw membershipError;
    const coach = Boolean(membership);
    const db = serviceClient();
    const visibleStudents = coach
      ? await db
          .from("students")
          .select("id,studio_id,full_name,referral_code")
          .eq("studio_id", membership!.studio_id)
          .is("deleted_at", null)
      : await user
          .from("students")
          .select("id,studio_id,full_name,referral_code")
          .is("deleted_at", null);
    if (visibleStudents.error) throw visibleStudents.error;
    const students = visibleStudents.data || [];
    const studioId = membership?.studio_id || students[0]?.studio_id;
    if (!studioId) throw new Error("FORBIDDEN");
    const selectedStudents = students.filter(
      (student) => student.studio_id === studioId,
    );
    const studentIds = selectedStudents.map((student) => student.id);
    if (!studentIds.length)
      return json({ students: [], referrals: [], rewards: [] });

    let referralQuery = db
      .from("referrals")
      .select(
        "id,referrer_student_id,referred_student_id,referred_email,created_at,source_booking_id",
      )
      .eq("studio_id", studioId)
      .order("created_at", { ascending: false });
    if (!coach)
      referralQuery = referralQuery.in("referrer_student_id", studentIds);
    const { data: referrals, error: referralError } = await referralQuery;
    if (referralError) throw referralError;
    const referralIds = (referrals || []).map((referral) => referral.id);
    const { data: rewards, error: rewardError } = referralIds.length
      ? await db
          .from("referral_rewards")
          .select(
            "id,referral_id,kind,created_at,discount_code_id,earned_booking_id",
          )
          .in("referral_id", referralIds)
      : { data: [], error: null };
    if (rewardError) throw rewardError;
    const discountIds = (rewards || []).map(
      (reward) => reward.discount_code_id,
    );
    const { data: discounts, error: discountError } = discountIds.length
      ? await db
          .from("discount_codes")
          .select("id,code,redemption_count")
          .in("id", discountIds)
      : { data: [], error: null };
    if (discountError) throw discountError;
    const discountMap = new Map(
      (discounts || []).map((discount) => [discount.id, discount]),
    );
    return json({
      students: selectedStudents.map((student) => ({
        id: student.id,
        name: student.full_name,
        code: student.referral_code,
      })),
      referrals: referrals || [],
      rewards: (rewards || []).map((reward) => ({
        id: reward.id,
        referralId: reward.referral_id,
        kind: reward.kind,
        code: discountMap.get(reward.discount_code_id)?.code || "",
        redeemed:
          Number(
            discountMap.get(reward.discount_code_id)?.redemption_count || 0,
          ) > 0,
        earnedBookingId: reward.earned_booking_id,
        createdAt: reward.created_at,
      })),
    });
  } catch (error) {
    return apiError(error, crypto.randomUUID());
  }
};

export const config: Config = { path: "/api/v2/referrals" };
