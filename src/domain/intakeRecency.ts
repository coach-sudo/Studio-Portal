export function pastOccurrence(startsAt?: string | null, endsAt?: string | null, now = Date.now()): boolean {
  const timestamp = Date.parse(endsAt || startsAt || "");
  return Number.isFinite(timestamp) && timestamp < now;
}

export function staleReviewPayload(payload: Record<string, any> | null | undefined, now = Date.now()): boolean {
  if (!payload) return false;
  const candidate = payload.candidate;
  const startsAt = candidate?.startsAt || payload.start?.dateTime || payload.start?.date;
  const endsAt = candidate?.endsAt || payload.end?.dateTime || payload.end?.date;
  if (startsAt) return pastOccurrence(startsAt, endsAt, now);
  const emailDate = Date.parse(payload.headers?.date || "");
  return Number.isFinite(emailDate) && emailDate < now - 30 * 86400000;
}
