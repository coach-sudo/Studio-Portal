import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { readApiClientError } from "./apiClientError";

export interface CampaignContact {
  email: string;
  name: string;
  subscribed: boolean;
}
export interface CampaignHistory {
  id: string;
  name: string;
  subject_template: string;
  recipient_count: number;
  created_at: string;
  queued_count: number;
  sent_count: number;
  failed_count: number;
  cancelled_count: number;
}
export interface CampaignOverview {
  contacts: CampaignContact[];
  campaigns: CampaignHistory[];
}

async function campaignRequest(
  method: "GET" | "POST",
  body?: Record<string, unknown>,
) {
  if (!isSupabaseConfigured || !supabase)
    throw new Error("Production database is not configured.");
  const { data } = await supabase.auth.getSession();
  if (!data.session)
    throw new Error("Sign in as the coach to manage campaigns.");
  const response = await fetch("/api/v2/admin/campaigns", {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok)
    throw await readApiClientError(response, "Campaign request failed.");
  const result = await response.json();
  return result;
}

export async function loadCampaignOverview(): Promise<CampaignOverview> {
  return campaignRequest("GET");
}

export async function queueCampaign(input: {
  idempotencyKey: string;
  name: string;
  subject: string;
  body: string;
}): Promise<{ id: string; recipientCount: number; alreadyQueued: boolean }> {
  const result = await campaignRequest("POST", input);
  return result.campaign;
}
