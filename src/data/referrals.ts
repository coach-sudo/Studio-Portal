import { isDemoMode, supabase } from "../lib/supabase";
import { readApiClientError } from "./apiClientError";

export interface ReferralOverview {
  students: { id: string; name: string; code: string }[];
  referrals: {
    id: string;
    referrer_student_id: string;
    referred_student_id: string;
    referred_email: string;
    created_at: string;
    source_booking_id: string;
  }[];
  rewards: {
    id: string;
    referralId: string;
    kind: "paid_lesson" | "recurring_slot";
    code: string;
    redeemed: boolean;
    earnedBookingId: string;
    createdAt: string;
  }[];
}

export async function loadReferralOverview(): Promise<ReferralOverview> {
  if (isDemoMode || !supabase)
    throw new Error("Live referrals are unavailable in the demo.");
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Please sign in again.");
  const response = await fetch("/api/v2/referrals", {
    headers: { Authorization: `Bearer ${data.session.access_token}` },
  });
  if (!response.ok)
    throw await readApiClientError(response, "Could not load referrals.");
  const result = await response.json();
  return result as ReferralOverview;
}
