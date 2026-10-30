import { z } from "zod";
import type { Json } from "../../../src/types/database.generated";
import { AppError, json } from "../_shared/http";
import { googleAccessToken } from "../_shared/google";
import { serviceClient } from "../_shared/supabase";
import {
  accessibleCalendarPage,
  calendarDiscoveryPage,
  DiscoveryProviderError,
  type DiscoveryFailureCode,
} from "../_shared/calendar-discovery";
import type { V2CommandContext } from "./types";

const startSchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    timezone: z.string().min(1).max(100),
    calendars: z
      .array(
        z.object({
          id: z.string().min(1).max(1024),
          label: z.string().max(1000).optional(),
          timezone: z.string().nullable().optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .refine((v) => Date.parse(v.to) > Date.parse(v.from), {
    message: "Choose an increasing date range.",
  });
const pageSchema = z.object({
  scanId: z.string().uuid(),
  calendarId: z.string().min(1).max(1024),
  pageSequence: z.number().int().nonnegative(),
});
const claimSchema = z.object({
  replay: z.literal(false),
  claimToken: z.string().uuid(),
  scanId: z.string().uuid(),
  calendarId: z.string(),
  pageSequence: z.number(),
  from: z.string(),
  to: z.string(),
  calendarTimezone: z.string().nullable(),
  pageToken: z.string().nullable(),
});
const replaySchema = z.object({ replay: z.literal(true), result: z.unknown() });
const failures: Record<DiscoveryFailureCode, string> = {
  access_denied:
    "Google could not authorize this read. Reconnect or select an accessible calendar, then retry this saved page.",
  rate_limited:
    "Google is limiting reads. This page is saved; retry it after waiting.",
  provider_unavailable:
    "Google could not complete this read. Successful pages are saved; retry the failed page.",
  invalid_payload:
    "Google returned an incomplete or invalid response. This page has not advanced; retry or review the connection.",
  invalid_pagination:
    "Google repeated a page cursor. This preview is retained; start a fresh reviewed preview to recover.",
  checkpoint_unconfirmed:
    "The page checkpoint could not be confirmed. Refresh progress, then retry unchanged to recover its saved receipt.",
};
export async function handleCalendarDiscovery(
  ctx: V2CommandContext,
): Promise<Response | null> {
  if (
    ctx.domain !== "integrations" ||
    ![
      "list_calendars",
      "start_calendar_discovery",
      "continue_calendar_discovery",
      "calendar_discovery_progress",
      "list_calendar_discoveries",
    ].includes(ctx.input.command)
  )
    return null;
  const studio = await ctx.requireCoach(),
    { input, db } = ctx;
  if (input.command === "calendar_discovery_progress") {
    const payload = z
      .object({
        scanId: z.string().uuid(),
        cursor: z.string().uuid().nullable().optional(),
      })
      .parse(input.payload);
    const result = await db.rpc("calendar_discovery_progress", {
      p_scan: payload.scanId,
      p_cursor: payload.cursor ?? undefined,
    });
    if (result.error) throw result.error;
    return json({ resource: result.data });
  }
  if (input.command === "list_calendar_discoveries") {
    const payload = z
      .object({
        cursor: z
          .object({
            createdAt: z.string().datetime({ offset: true }),
            id: z.string().uuid(),
          })
          .nullable()
          .optional(),
      })
      .parse(input.payload);
    const result = await db.rpc("list_calendar_discoveries", {
      p_studio: studio,
      p_cursor: payload.cursor ?? undefined,
    });
    if (result.error) throw result.error;
    return json({ resource: result.data });
  }
  // Global Google credentials must never become another studio's discovery API.
  // No environment setting is changed by this implementation.
  if (Netlify.env.get("GOOGLE_DISCOVERY_STUDIO_ID") !== studio)
    throw new AppError("REVIEW_REQUIRED", {
      status: 409,
      message:
        "Calendar preview requires an explicit Google-to-studio binding. Routine intake settings are unchanged.",
    });
  const auth = await db.auth.getUser();
  if (auth.error || !auth.data.user) throw AppError.forbidden();
  const actor = auth.data.user.id,
    service = serviceClient();
  if (input.command === "start_calendar_discovery") {
    const payload = startSchema.parse(input.payload);
    const result = await service.rpc("start_calendar_discovery", {
      p_actor: actor,
      p_studio: studio,
      p_value: payload as Json,
      p_key: input.idempotencyKey,
    });
    if (result.error) throw result.error;
    return json(
      {
        resource: result.data,
        processing: "preview_requested",
        canonicalEffects: [],
      },
      202,
    );
  }
  if (input.command === "list_calendars") {
    const payload = z
      .object({ cursor: z.string().max(10000).optional() })
      .parse(input.payload);
    try {
      return json({
        resource: await accessibleCalendarPage(
          await googleAccessToken(),
          payload.cursor,
        ),
      });
    } catch (e) {
      const code =
        e instanceof DiscoveryProviderError ? e.code : "provider_unavailable";
      throw new AppError("PROVIDER_UNAVAILABLE", {
        status: 503,
        message: failures[code],
        retryable: code !== "invalid_pagination",
      });
    }
  }
  const payload = pageSchema.parse(input.payload);
  const accepted = await service.rpc("claim_calendar_discovery_page", {
    p_actor: actor,
    p_scan: payload.scanId,
    p_calendar: payload.calendarId,
    p_sequence: payload.pageSequence,
    p_key: input.idempotencyKey,
  });
  if (accepted.error) {
    if (accepted.error.message.includes("DISCOVERY_RUNNING"))
      throw new AppError("VERSION_CONFLICT", {
        status: 409,
        message:
          "This saved page is already running. Refresh preview progress before retrying.",
        retryable: true,
      });
    throw accepted.error;
  }
  const replay = replaySchema.safeParse(accepted.data);
  if (replay.success)
    return json({ resource: replay.data.result, canonicalEffects: [] });
  const claim = claimSchema.parse(accepted.data);
  let checkpointRequested = false;
  try {
    const page = await calendarDiscoveryPage(await googleAccessToken(), claim);
    checkpointRequested = true;
    const result = await service.rpc("finish_calendar_discovery_page", {
      p_scan: payload.scanId,
      p_calendar: payload.calendarId,
      p_sequence: payload.pageSequence,
      p_claim: claim.claimToken,
      p_value: page as Json,
    });
    if (result.error) throw result.error;
    return json({
      resource: result.data,
      processing: "preview_page_saved",
      canonicalEffects: [],
    });
  } catch (e) {
    const code: DiscoveryFailureCode =
      e instanceof DiscoveryProviderError
        ? e.code
        : typeof e === "object" &&
            e !== null &&
            "message" in e &&
            String(e.message).includes("INVALID_DISCOVERY_PAGINATION")
          ? "invalid_pagination"
          : checkpointRequested
            ? "checkpoint_unconfirmed"
            : "provider_unavailable";
    const saved = await service.rpc("fail_calendar_discovery_page", {
      p_scan: payload.scanId,
      p_calendar: payload.calendarId,
      p_claim: claim.claimToken,
      p_code: code,
    });
    if (saved.error)
      throw new AppError("PROVIDER_UNAVAILABLE", {
        status: 503,
        message:
          "Preview recovery status could not be saved. Refresh this preview before retrying; a prior checkpoint may already be committed.",
        retryable: true,
      });
    throw new AppError("PROVIDER_UNAVAILABLE", {
      status: 503,
      message: failures[code],
      retryable: code !== "invalid_pagination",
      details: { failureCode: code },
    });
  }
}
