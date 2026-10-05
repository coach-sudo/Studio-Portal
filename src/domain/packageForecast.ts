import { creditBalance } from "./finance";
import type {
  Booking,
  CreditEntry,
  Lesson,
  PackageAccount,
  PackageDefinition,
  StudioSnapshot,
} from "./model";

export type CoverageData = Pick<
  StudioSnapshot,
  | "lessons"
  | "bookings"
  | "lessonParticipants"
  | "packages"
  | "packageDefinitions"
  | "creditEntries"
>;

export function bookingForLesson(
  lesson: Lesson,
  data: Pick<CoverageData, "bookings" | "lessonParticipants">,
): Booking | undefined {
  const ids = new Set(
    data.lessonParticipants
      .filter(
        (item) =>
          item.lessonId === lesson.id && item.studentId === lesson.studentId,
      )
      .map((item) => item.bookingId),
  );
  const candidates = data.bookings.filter((booking) =>
    ids.size
      ? ids.has(booking.id)
      : booking.studentId === lesson.studentId &&
        booking.startsAt === lesson.startsAt &&
        booking.endsAt === lesson.endsAt,
  );
  // Group/ambiguous bookings cannot be reconciled by choosing an arbitrary record.
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function reservedForLesson(
  packageId: string,
  lessonId: string,
  entries: readonly CreditEntry[],
) {
  return (
    entries
      .filter(
        (entry) => entry.packageId === packageId && entry.lessonId === lessonId,
      )
      .reduce((total, entry) => total + entry.quantity, 0) < 0
  );
}

export function packageApplies(
  pkg: PackageAccount,
  definition: PackageDefinition | undefined,
  lesson: Lesson,
  checkExpiry = true,
) {
  if (pkg.studentId !== lesson.studentId) return false;
  if (
    checkExpiry &&
    pkg.expiresAt &&
    Date.parse(pkg.expiresAt) <= Date.parse(lesson.startsAt)
  )
    return false;
  if (!pkg.definitionId) return true; // Existing generic studio-credit packages.
  if (!definition?.active) return false;
  return (
    (definition.eligibleServiceIds.length === 0 ||
      Boolean(
        lesson.serviceId &&
        definition.eligibleServiceIds.includes(lesson.serviceId),
      )) &&
    definition.sessionDurationMinutes ===
      (Date.parse(lesson.endsAt) - Date.parse(lesson.startsAt)) / 60_000 &&
    definition.meetingProviders.includes(
      lesson.meetingProvider ??
        (lesson.locationType === "in_person" ? "in_person" : "google_meet"),
    )
  );
}

export interface PackageForecast {
  packageId: string;
  currentCredits: number;
  eligibleLessonIds: string[];
  reservedLessonIds: string[];
  expectedConsumption: number;
  projectedCredits: number;
  firstUncoveredLessonId?: string;
  uncoveredLessonIds: string[];
  expiresBeforeLessonIds: string[];
}

/** Projection only. Reservations already reduce the ledger; never subtract them twice. */
export function forecastPackages(
  studentId: string,
  data: CoverageData,
  now: number,
): PackageForecast[] {
  const packages = data.packages
    .filter((pkg) => pkg.studentId === studentId)
    .sort(
      (a, b) =>
        (a.expiresAt ?? "9999").localeCompare(b.expiresAt ?? "9999") ||
        a.id.localeCompare(b.id),
    );
  const forecasts = new Map(
    packages.map((pkg) => [
      pkg.id,
      {
        packageId: pkg.id,
        currentCredits: creditBalance(pkg.id, data.creditEntries),
        eligibleLessonIds: [],
        reservedLessonIds: [],
        expectedConsumption: 0,
        projectedCredits: creditBalance(pkg.id, data.creditEntries),
        uncoveredLessonIds: [],
        expiresBeforeLessonIds: [],
      } as PackageForecast,
    ]),
  );
  const lessons = data.lessons
    .filter(
      (lesson) =>
        lesson.studentId === studentId &&
        lesson.status === "scheduled" &&
        Date.parse(lesson.endsAt) > now,
    )
    .sort(
      (a, b) =>
        a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
    );
  for (const lesson of lessons) {
    const booking = bookingForLesson(lesson, data);
    if (
      ["paid", "waived"].includes(lesson.paymentStatus ?? "") ||
      ["paid", "partially_paid", "processing", "not_required"].includes(
        booking?.paymentStatus ?? "",
      )
    )
      continue;
    const definitionFor = (pkg: PackageAccount) =>
      data.packageDefinitions.find((item) => item.id === pkg.definitionId);
    const reserved = packages.find((pkg) =>
      reservedForLesson(pkg.id, lesson.id, data.creditEntries),
    );
    if (reserved) {
      const forecast = forecasts.get(reserved.id)!;
      forecast.eligibleLessonIds.push(lesson.id);
      forecast.reservedLessonIds.push(lesson.id);
      continue;
    }
    // Partially paid cash lessons are not eligible for automatic credit conversion.
    if (
      lesson.paymentStatus === "partially_paid" ||
      (lesson.paidMinor ?? 0) > 0
    )
      continue;
    const applicable = packages.filter(
      (pkg) =>
        (pkg.id === lesson.packageId || pkg.autoApply === true) &&
        packageApplies(pkg, definitionFor(pkg), lesson),
    );
    const chosen =
      applicable.find((pkg) => forecasts.get(pkg.id)!.projectedCredits > 0) ??
      applicable[0];
    if (chosen) {
      const forecast = forecasts.get(chosen.id)!;
      forecast.eligibleLessonIds.push(lesson.id);
      forecast.expectedConsumption += 1;
      forecast.projectedCredits -= 1;
      if (forecast.projectedCredits < 0) {
        forecast.uncoveredLessonIds.push(lesson.id);
        forecast.firstUncoveredLessonId ??= lesson.id;
      }
    } else {
      const expired = packages.find(
        (pkg) =>
          (pkg.id === lesson.packageId || pkg.autoApply === true) &&
          packageApplies(pkg, definitionFor(pkg), lesson, false),
      );
      if (expired) {
        const forecast = forecasts.get(expired.id)!;
        forecast.expiresBeforeLessonIds.push(lesson.id);
        forecast.uncoveredLessonIds.push(lesson.id);
        forecast.firstUncoveredLessonId ??= lesson.id;
      }
    }
  }
  return [...forecasts.values()];
}
