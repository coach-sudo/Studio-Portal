import { formatMoney } from "../../domain/finance";
import type { BookingService } from "../../domain/model";

export function exactBookingPriceLabel(amountMinor: number, currency: string) {
  return amountMinor === 0 ? "Free" : formatMoney(amountMinor, currency);
}

export function serviceCatalogPriceLabel(service: BookingService) {
  const prices = service.locationOptions.map(
    (location) =>
      service.priceMinor +
      Number(service.locationPriceAdjustments[location] || 0),
  );
  const available = prices.length ? prices : [service.priceMinor];
  const minimum = Math.min(...available);
  const maximum = Math.max(...available);
  if (maximum === 0) return "Free";
  if (minimum !== maximum)
    return `From ${formatMoney(minimum, service.currency)}`;
  return formatMoney(minimum, service.currency);
}
