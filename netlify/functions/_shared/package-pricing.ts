import type { SupabaseClient } from "@supabase/supabase-js";

export type PackageDiscountType = "none" | "fixed" | "percent";

export function calculatePackagePrice(input: {
  unitPriceMinor: number;
  sessionCount: number;
  discountType: PackageDiscountType;
  discountMinor?: number;
  discountBasisPoints?: number;
}) {
  const sessionCount = Math.max(1, Math.round(input.sessionCount));
  const basePriceMinor = Math.max(0, Math.round(input.unitPriceMinor)) * sessionCount;
  const requested = input.discountType === "percent"
    ? Math.round(basePriceMinor * Math.min(10000, Math.max(0, Number(input.discountBasisPoints || 0))) / 10000)
    : input.discountType === "fixed" ? Math.max(0, Math.round(Number(input.discountMinor || 0))) : 0;
  const discountMinor = Math.min(basePriceMinor, requested);
  return { basePriceMinor, discountMinor, priceMinor: basePriceMinor - discountMinor };
}

export async function derivePackageValues(
  db: SupabaseClient,
  studioId: string,
  payload: Record<string, unknown>,
  studentId?: string,
) {
  const serviceId = String(payload.pricingServiceId || payload.serviceId || "");
  const deliveryFormat = payload.deliveryFormat === "in_person" ? "in_person" : "google_meet";
  const sessionCount = Number(payload.sessionCount);
  if (!serviceId || !Number.isInteger(sessionCount) || sessionCount < 1 || sessionCount > 100)
    throw new Error("VALIDATION_FAILED: Choose a service and a valid lesson count.");
  const [{ data: service, error: serviceError }, { data: studio, error: studioError }] = await Promise.all([
    db.from("booking_services").select("id,name,duration_minutes,price_minor,currency,version").eq("id", serviceId).eq("studio_id", studioId).eq("active", true).single(),
    db.from("studios").select("settings").eq("id", studioId).single(),
  ]);
  if (serviceError || studioError || !service) throw serviceError || studioError || new Error("Service pricing is unavailable.");
  let unitPriceMinor = Number(service.price_minor);
  if (studentId) {
    const { data: rule } = await db.from("student_pricing_rules").select("price_minor").eq("student_id", studentId).eq("service_id", serviceId).eq("active", true).is("ends_at", null).maybeSingle();
    if (rule) unitPriceMinor = Number(rule.price_minor);
  }
  if (deliveryFormat === "in_person")
    unitPriceMinor += Number(studio.settings?.bookingDefaults?.inPersonUpchargeMinor || 0);
  const discountType = (["none", "fixed", "percent"].includes(String(payload.discountType)) ? payload.discountType : "none") as PackageDiscountType;
  const price = calculatePackagePrice({
    unitPriceMinor,
    sessionCount,
    discountType,
    discountMinor: Number(payload.discountMinor || 0),
    discountBasisPoints: Number(payload.discountBasisPoints || 0),
  });
  return {
    service,
    values: {
      studio_id: studioId,
      name: String(payload.name || `${service.name} — ${sessionCount} lesson${sessionCount === 1 ? "" : "s"}`).trim(),
      description: String(payload.description || ""),
      session_count: sessionCount,
      session_duration_minutes: Number(service.duration_minutes),
      price_minor: price.priceMinor,
      base_price_minor: price.basePriceMinor,
      discount_minor: price.discountMinor,
      discount_type: discountType,
      discount_basis_points: discountType === "percent" ? Number(payload.discountBasisPoints || 0) : 0,
      currency: String(service.currency || "USD").toUpperCase(),
      expiration_days: payload.expirationDays ? Number(payload.expirationDays) : null,
      eligible_service_ids: [service.id],
      meeting_providers: [deliveryFormat],
      delivery_format: deliveryFormat,
      recurring_eligible: Array.isArray(payload.renewalModes) && payload.renewalModes.some((mode) => mode !== "one_time"),
      visibility: payload.visibility === "public" ? "public" : "private",
      direct_purchase: Boolean(payload.directPurchase),
      giftable: Boolean(payload.giftable),
      active: payload.active !== false,
      pricing_service_id: service.id,
      pricing_service_version: service.version,
      pricing_status: "current",
    },
  };
}
