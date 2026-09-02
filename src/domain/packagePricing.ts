import type { BookingService, PackageDefinition } from "./model";

export interface PackagePriceInput {
  unitPriceMinor: number;
  sessionCount: number;
  discountType: "none" | "fixed" | "percent";
  discountMinor?: number;
  discountBasisPoints?: number;
}

export function calculatePackagePrice(input: PackagePriceInput) {
  const basePriceMinor = Math.max(0, Math.round(input.unitPriceMinor)) * Math.max(1, Math.round(input.sessionCount));
  const requestedDiscount = input.discountType === "percent"
    ? Math.round(basePriceMinor * Math.min(10000, Math.max(0, input.discountBasisPoints || 0)) / 10000)
    : input.discountType === "fixed" ? Math.max(0, Math.round(input.discountMinor || 0)) : 0;
  const discountMinor = Math.min(basePriceMinor, requestedDiscount);
  return { basePriceMinor, discountMinor, priceMinor: basePriceMinor - discountMinor };
}

export function packagePricingChanged(definition: PackageDefinition, service?: BookingService) {
  if (!service || !definition.pricingServiceId || definition.pricingStatus === "legacy") return false;
  return definition.pricingServiceVersion !== service.version;
}

