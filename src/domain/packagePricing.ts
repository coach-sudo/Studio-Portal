import type {
  BookingService,
  PackageDefinition,
  Student,
  StudentPricingRule,
  StudioSnapshot,
} from "./model";

export interface PackagePriceInput {
  unitPriceMinor: number;
  sessionCount: number;
  discountType: "none" | "fixed" | "percent";
  discountMinor?: number;
  discountBasisPoints?: number;
}

export function calculatePackagePrice(input: PackagePriceInput) {
  const basePriceMinor =
    Math.max(0, Math.round(input.unitPriceMinor)) *
    Math.max(1, Math.round(input.sessionCount));
  const requestedDiscount =
    input.discountType === "percent"
      ? Math.round(
          (basePriceMinor *
            Math.min(10000, Math.max(0, input.discountBasisPoints || 0))) /
            10000,
        )
      : input.discountType === "fixed"
        ? Math.max(0, Math.round(input.discountMinor || 0))
        : 0;
  const discountMinor = Math.min(basePriceMinor, requestedDiscount);
  return {
    basePriceMinor,
    discountMinor,
    priceMinor: basePriceMinor - discountMinor,
  };
}

export function packagePricingChanged(
  definition: PackageDefinition,
  service?: BookingService,
) {
  if (
    !service ||
    !definition.pricingServiceId ||
    definition.pricingStatus === "legacy"
  )
    return false;
  return definition.pricingServiceVersion !== service.version;
}

/** Only offer definitions are repriced. Purchased packages remain immutable snapshots. */
export function packageOffer(
  definition: PackageDefinition,
  data: Pick<
    StudioSnapshot,
    "bookingServices" | "studentPricingRules" | "settings"
  >,
  student?: Student,
  now = Date.now(),
): PackageDefinition | undefined {
  if (!definition.pricingServiceId) return definition;
  const service = data.bookingServices.find(
    (item) =>
      item.id === definition.pricingServiceId &&
      item.studioId === definition.studioId,
  );
  if (!service) return undefined;
  const rule = student?.specialPricingEnabled
    ? data.studentPricingRules
        .filter(
          (item) =>
            item.studioId === definition.studioId &&
            item.studentId === student.id &&
            item.serviceId === service.id &&
            pricingRuleEffective(item, now),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    : undefined;
  const delivery = definition.deliveryFormat ?? "google_meet";
  const adjustment =
    rule?.locationPriceAdjustments?.[delivery] ??
    service.locationPriceAdjustments?.[delivery] ??
    (delivery === "in_person"
      ? data.settings.bookingDefaults.inPersonUpchargeMinor
      : 0);
  const price = calculatePackagePrice({
    unitPriceMinor:
      (rule?.priceMinor ?? service.priceMinor) + (adjustment ?? 0),
    sessionCount: definition.sessionCount,
    discountType: definition.discountType ?? "none",
    discountMinor: definition.discountMinor,
    discountBasisPoints: definition.discountBasisPoints,
  });
  return {
    ...definition,
    ...price,
    currency: service.currency,
    pricingServiceVersion: service.version,
  };
}

export function pricingRuleEffective(
  rule: Pick<StudentPricingRule, "active" | "startsAt" | "endsAt">,
  now: number,
) {
  return (
    rule.active &&
    Date.parse(rule.startsAt) <= now &&
    (!rule.endsAt || Date.parse(rule.endsAt) >= now)
  );
}
