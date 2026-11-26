import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { calendarOAuthConfig, calendarOAuthStudio } from "./calendar-oauth";
import { AppError } from "./http";
import { serviceClient } from "./supabase";

const id = z.string().min(1).max(1024);
const roles = z
  .object({
    outgoing: id,
    availability: z.array(id).min(1).max(20),
    incoming: z.array(id).max(20),
  })
  .strict();
export type CalendarRoles = z.infer<typeof roles>;
export const defaultCalendarId = () =>
  Netlify.env.get("GOOGLE_CALENDAR_ID") || "primary";

export async function activeCalendarRoles(): Promise<CalendarRoles> {
  const defaultId = defaultCalendarId();
  const fallback = {
    outgoing: defaultId,
    availability: [defaultId],
    incoming: [defaultId],
  };
  if (!calendarOAuthConfig()) return fallback;
  const db = serviceClient(),
    studio = await calendarOAuthStudio(db);
  if (!studio) throw Error("Calendar studio is unavailable.");
  const stored = await db
    .rpc("calendar_roles", { p_studio: studio })
    .abortSignal(AbortSignal.timeout(3000));
  if (stored.error) throw Error("Calendar roles are unavailable.");
  return stored.data === null ? fallback : roles.parse(stored.data);
}

const choices = z.object({
  items: z
    .array(
      z.object({
        id,
        summary: z.string().optional(),
        primary: z.boolean().optional(),
        accessRole: z.enum(["freeBusyReader", "reader", "writer", "owner"]),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
});
const canWrite = (role: string) => role === "owner" || role === "writer";

export async function manageCalendarRoles(
  request: Request,
  db: SupabaseClient,
  studio: string,
  actor: string,
  authorize: (signal: AbortSignal) => Promise<string>,
) {
  if (!calendarOAuthConfig() || studio !== (await calendarOAuthStudio(db)))
    throw AppError.forbidden();
  const command = await request.json().catch(() => null);
  const payload = z.union([z.object({}).strict(), roles]).safeParse(command);
  if (!payload.success)
    throw new AppError("VALIDATION_FAILED", {
      status: 400,
      message: "Choose accessible calendars for each role.",
    });
  const signal = AbortSignal.timeout(7000),
    token = await authorize(signal);
  const calendars: NonNullable<z.infer<typeof choices>["items"]> = [];
  let nextPage: string | undefined;
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      maxResults: "100",
      fields: "items(id,summary,primary,accessRole),nextPageToken",
    });
    if (nextPage) params.set("pageToken", nextPage);
    const response = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?" + params,
      {
        headers: { Authorization: "Bearer " + token },
        signal,
        redirect: "error",
      },
    );
    if (!response.ok)
      throw new AppError("PROVIDER_UNAVAILABLE", {
        status: 502,
        message:
          "Google Calendar access could not be verified. Test or reauthorize the connection.",
      });
    const data = choices.parse(await response.json());
    calendars.push(...(data.items ?? []));
    nextPage = data.nextPageToken;
    if (!nextPage) break;
  }
  if (nextPage) throw Error("Calendar list could not be verified in full.");
  const providerDefault = defaultCalendarId();
  const canonical = (id: string) =>
    id === "primary"
      ? (calendars.find((calendar) => calendar.primary)?.id ?? id)
      : id;
  if ("outgoing" in payload.data) {
    const saved = payload.data as CalendarRoles;
    const access = new Map(
      calendars.map(({ id, accessRole }) => [id, accessRole]),
    );
    if (
      !canWrite(access.get(saved.outgoing) ?? "") ||
      saved.availability.some((calendar) => !access.has(calendar)) ||
      saved.incoming.some(
        (calendar) =>
          !access.has(calendar) || access.get(calendar) === "freeBusyReader",
      )
    )
      throw new AppError("VALIDATION_FAILED", {
        status: 400,
        message: "One or more calendars lack the required permissions.",
      });
    const result = await db.rpc("save_calendar_roles", {
      p_studio: studio,
      p_actor: actor,
      p_default: canonical(providerDefault),
      p_outgoing: saved.outgoing,
      p_availability: [...new Set(saved.availability)],
      p_incoming: [...new Set(saved.incoming)],
    });
    if (result.error) throw Error("Calendar roles could not be saved.");
    if (result.data !== true)
      throw new AppError("VERSION_CONFLICT", {
        status: 409,
        message:
          "Existing Calendar mappings must be reviewed before the outgoing calendar can change.",
      });
  }
  const current = await activeCalendarRoles();
  return {
    roles: {
      outgoing: canonical(current.outgoing),
      availability: current.availability.map(canonical),
      incoming: current.incoming.map(canonical),
    },
    calendars: calendars.map(({ id, summary, accessRole }) => ({
      id,
      label: (summary || id).replace(/\p{Cc}/gu, " ").slice(0, 140),
      write: canWrite(accessRole),
      read: accessRole !== "freeBusyReader",
    })),
  };
}
