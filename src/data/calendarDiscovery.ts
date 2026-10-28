import { studioCommand } from "./bookingCommands";
import { z } from "zod";
import {
  accessibleCalendarsSchema,
  discoveryAcceptedSchema,
  discoveryCheckpointSchema,
  discoveryProgressSchema,
  savedDiscoveriesSchema,
  type DiscoveryPageRequest,
  type DiscoveryRequest,
  type SavedDiscoveries,
} from "../domain/calendarDiscovery";
const read = async (
  command: string,
  payload: Record<string, unknown>,
  key?: string,
) => {
  const result = await studioCommand("integrations", {
    command,
    payload,
    idempotencyKey: key,
    expectedVersion: 0,
    reason: "Coach reviews Calendar discovery preview",
  });
  return result.resource as unknown;
};
function verified<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Preview information could not be verified. Refresh progress before retrying; your input is retained.",
    );
  return parsed.data;
}
export const listAccessibleCalendars = async (cursor?: string) =>
  verified(accessibleCalendarsSchema, await read("list_calendars", { cursor }));
export const startCalendarDiscovery = async (
  payload: DiscoveryRequest,
  key: string,
) =>
  verified(
    discoveryAcceptedSchema,
    await read("start_calendar_discovery", { ...payload }, key),
  );
export const continueCalendarDiscovery = async (
  payload: DiscoveryPageRequest,
  key: string,
) => {
  const result = verified(
    discoveryCheckpointSchema,
    await read("continue_calendar_discovery", { ...payload }, key),
  );
  if (
    result.scanId !== payload.scanId ||
    result.calendarId !== payload.calendarId ||
    result.pageSequence !== payload.pageSequence
  )
    throw new Error(
      "The returned checkpoint does not match the requested page. Refresh progress and retry unchanged.",
    );
  return result;
};
export const loadDiscoveryProgress = async (
  scanId: string,
  cursor?: string,
) => {
  const result = verified(
    discoveryProgressSchema,
    await read("calendar_discovery_progress", { scanId, cursor }),
  );
  if (result.scanId !== scanId)
    throw new Error(
      "The returned preview does not match this record. Refresh before continuing.",
    );
  return result;
};
export const listSavedDiscoveries = async (
  cursor?: SavedDiscoveries["nextCursor"],
) =>
  verified(
    savedDiscoveriesSchema,
    await read("list_calendar_discoveries", { cursor: cursor ?? undefined }),
  );
