import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { readApiClientError } from "./apiClientError";
import type { CampaignContent } from "../domain/campaignBlocks";
export interface CampaignDraftValue {
  name: string;
  subject: string;
  content: CampaignContent;
  recipientEmails: string[];
  sendAt: string | null;
}
export interface CampaignDraftRecord {
  id: string;
  version: number;
  value: CampaignDraftValue;
  review?: {
    id: string;
    expiresAt: string;
    audience: Array<{ email: string; name: string }>;
  } | null;
  result?: { id: string; recipientCount: number; sendAt: string } | null;
}

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
  drafts?: CampaignDraftRecord[];
  historyCount?: number;
}

async function campaignRequest(
  method: "GET" | "POST",
  body?: Record<string, unknown>,
  query = "",
) {
  if (!isSupabaseConfigured || !supabase)
    throw new Error("Production database is not configured.");
  const { data } = await supabase.auth.getSession();
  if (!data.session)
    throw new Error("Sign in as the coach to manage campaigns.");
  const response = await fetch("/api/v2/admin/campaigns" + query, {
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

export async function loadCampaignOverview(
  page = 1,
  search = "",
): Promise<CampaignOverview> {
  return campaignRequest(
    "GET",
    undefined,
    `?page=${page}&search=${encodeURIComponent(search)}`,
  );
}
export async function campaignDraftCommand(
  command: "read" | "save" | "review" | "queue",
  draftId: string,
  version: number,
  value: Record<string, unknown> = {},
) {
  const result = await campaignRequest("POST", {
    command,
    draftId,
    version,
    value,
    idempotencyKey: draftId,
  });
  return result.resource as CampaignDraftRecord & {
    recipientCount?: number;
    sendAt?: string;
  };
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
