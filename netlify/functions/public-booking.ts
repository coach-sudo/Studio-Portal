import type { Config, Context } from "@netlify/functions";
import Stripe from "stripe";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { apiError, correlationId, json } from "./_shared/http";
import { googleAccessToken, googleFreeBusy } from "./_shared/google";
import { publicBookingSchema } from "./_shared/schemas";
import { serviceClient, userClient } from "./_shared/supabase";
import {
  recurringDates,
  wallParts,
  zonedDateTimeToUtc,
} from "./_shared/timezone";
import { ensureBookingPortalAccess } from "./_shared/portal-access";
import { queueBookingEmails } from "./_shared/booking-email";
import { cancelConfirmedBooking } from "./_shared/booking-cancellation";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  aStart < bEnd && aEnd > bStart;
const reference = () => `SS-${Math.floor(100000 + Math.random() * 899999)}`;
const integrationIdentifier = () =>
  `studio_${Array.from(randomBytes(8), (value) => String.fromCharCode(97 + (value % 26))).join("")}`;
const TERMS_VERSION = "2026-08-20";
const localSlot = (value: string, timeZone: string) => {
  const date = new Date(value),
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date),
    weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      parts.find((item) => item.type === "weekday")?.value || "",
    );
  return {
    weekday,
    minutes:
      Number(parts.find((item) => item.type === "hour")?.value) * 60 +
      Number(parts.find((item) => item.type === "minute")?.value),
  };
};
const timeMinutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
};
async function publicStudioId(db: ReturnType<typeof serviceClient>) {
  const configured = Netlify.env.get("STUDIO_ID");
  if (configured) return configured;
  const slug = Netlify.env.get("STUDIO_SLUG") || "stage-story",
    { data, error } = await db
      .from("studios")
      .select("id")
      .eq("slug", slug)
      .single();
  if (error || !data) throw new Error("SERVICE_NOT_FOUND");
  return data.id as string;
}

async function publicServices() {
  const db = serviceClient();
  const studioId = await publicStudioId(db),
    [
      { data: studio, error: studioError },
      { data: services, error },
      { data: offerings, error: offeringError },
    ] = await Promise.all([
      db.from("studios").select("name,settings").eq("id", studioId).single(),
      db
        .from("booking_services")
        .select(
          "id,slug,name,description,category,duration_minutes,price_minor,deposit_minor,deposit_type,deposit_percentage,balance_due_timing,balance_due_hours,auto_charge_balance,currency,capacity,location_options,default_location,recurrence_options,payment_policies,buffer_before_minutes,buffer_after_minutes,buffer_by_location,location_price_adjustments,minimum_notice_hours,booking_horizon_days,slot_interval_minutes,policy,policy_version,version,updated_at",
        )
        .eq("studio_id", studioId)
        .eq("published", true)
        .order("price_minor"),
      db
        .from("service_offerings")
        .select(
          "id,service_id,title,description,meeting_url,resource_links,starts_at,ends_at,enrollment_closes_at,capacity,enrolled,lesson_ids,version,updated_at",
        )
        .eq("studio_id", studioId)
        .eq("published", true)
        .gt("enrollment_closes_at", new Date().toISOString())
        .order("starts_at"),
    ]);
  if (studioError || error || offeringError)
    throw studioError || error || offeringError;
  const normalizedServices = (services || []).map((item) => ({
      ...item,
      location_price_adjustments: {
        google_meet: 0,
        in_person: Number(
          studio.settings?.bookingDefaults?.inPersonUpchargeMinor || 0,
        ),
        ...(item.location_price_adjustments || {}),
      },
    })),
    branding = { ...(studio.settings?.branding || {}) };
  if (branding.logoStoragePath) {
    const { data: signed } = await db.storage
      .from("studio-materials")
      .createSignedUrl(branding.logoStoragePath, 3600);
    if (signed?.signedUrl) branding.logoUrl = signed.signedUrl;
  }
  return {
    studio: {
      name: studio.name,
      coachName: studio.settings?.coachName,
      branding,
      bookingCopy: studio.settings?.bookingCopy,
      bookingPage: studio.settings?.bookingPage,
      bookingDefaults: studio.settings?.bookingDefaults,
      contactEmail: studio.settings?.contactEmail,
    },
    services: normalizedServices,
    offerings,
  };
}

async function availability(url: URL) {
  const serviceId = url.searchParams.get("serviceId");
  if (!serviceId) throw new Error("VALIDATION_FAILED: serviceId is required.");
  const from = new Date(url.searchParams.get("from") || Date.now());
  if (Number.isNaN(from.getTime()))
    throw new Error("VALIDATION_FAILED: from must be an ISO timestamp.");
  const db = serviceClient(),
    studioId = await publicStudioId(db),
    { data: service, error: serviceError } = await db
      .from("booking_services")
      .select("*")
      .eq("id", serviceId)
      .eq("studio_id", studioId)
      .eq("published", true)
      .single();
  if (serviceError || !service)
    throw serviceError || new Error("SERVICE_NOT_FOUND");
  const [
    { data: rules, error: rulesError },
    { data: exceptions, error: exceptionsError },
    { data: lessons, error: lessonsError },
    { data: holds, error: holdsError },
  ] = await Promise.all([
    db
      .from("availability_rules")
      .select("*")
      .eq("studio_id", studioId)
      .or(`service_id.is.null,service_id.eq.${serviceId}`)
      .eq("active", true),
    db
      .from("availability_exceptions")
      .select("*")
      .eq("studio_id", studioId)
      .or(`service_id.is.null,service_id.eq.${serviceId}`)
      .gte("ends_at", from.toISOString()),
    db
      .from("lessons")
      .select("starts_at,ends_at,status")
      .eq("studio_id", studioId)
      .eq("status", "scheduled")
      .gte("ends_at", from.toISOString()),
    db
      .from("booking_holds")
      .select("starts_at,ends_at")
      .eq("studio_id", studioId)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString()),
  ]);
  if (rulesError || exceptionsError || lessonsError || holdsError)
    throw rulesError || exceptionsError || lessonsError || holdsError;
  const absoluteHorizon =
    Date.now() + Number(service.booking_horizon_days) * 86400000;
  if (from.getTime() > absoluteHorizon) return [];
  const horizon = new Date(
      Math.min(from.getTime() + 45 * 86400000, absoluteHorizon),
    ),
    token = await googleAccessToken(),
    busy = await googleFreeBusy(
      token,
      from.toISOString(),
      horizon.toISOString(),
    );
  const blocks = [
    ...(lessons || []),
    ...(holds || []),
    ...busy,
    ...(exceptions || []).filter((item) => item.kind === "unavailable"),
  ].map((item: any) => ({
    start: new Date(item.starts_at || item.start).getTime(),
    end: new Date(item.ends_at || item.end).getTime(),
  }));
  const windows: { start: number; end: number }[] = [];
  for (const rule of rules || []) {
    const zone = rule.timezone || "America/New_York",
      first = wallParts(from, zone),
      [sh, sm] = String(rule.starts_at_local).split(":").map(Number),
      [eh, em] = String(rule.ends_at_local).split(":").map(Number);
    for (let day = 0; day < 45; day++) {
      const localDay = new Date(
        Date.UTC(first.year, first.month - 1, first.day + day),
      );
      if (localDay.getUTCDay() !== rule.weekday) continue;
      const date = {
        year: localDay.getUTCFullYear(),
        month: localDay.getUTCMonth() + 1,
        day: localDay.getUTCDate(),
      };
      windows.push({
        start: zonedDateTimeToUtc(
          { ...date, hour: sh, minute: sm },
          zone,
        ).getTime(),
        end: zonedDateTimeToUtc(
          { ...date, hour: eh, minute: em },
          zone,
        ).getTime(),
      });
    }
  }
  for (const item of (exceptions || []).filter(
    (value) => value.kind === "available",
  ))
    windows.push({
      start: new Date(item.starts_at).getTime(),
      end: new Date(item.ends_at).getTime(),
    });
  const unique = new Map<string, { startsAt: string; endsAt: string }>();
  for (const window of windows) {
    for (
      let cursor = window.start;
      cursor + service.duration_minutes * 60000 <= window.end;
      cursor += service.slot_interval_minutes * 60000
    ) {
      const slotEnd = cursor + service.duration_minutes * 60000;
      if (
        cursor > Date.now() + service.minimum_notice_hours * 3600000 &&
        cursor <= horizon.getTime() &&
        !blocks.some((block) =>
          overlaps(
            cursor - service.buffer_before_minutes * 60000,
            slotEnd + service.buffer_after_minutes * 60000,
            block.start,
            block.end,
          ),
        )
      ) {
        const value = {
          startsAt: new Date(cursor).toISOString(),
          endsAt: new Date(slotEnd).toISOString(),
        };
        unique.set(value.startsAt, value);
      }
    }
  }
  return [...unique.values()]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 1000);
}

async function createBooking(request: Request) {
  const idempotency = request.headers.get("idempotency-key") || randomUUID(),
    raw = await request.json(),
    input = publicBookingSchema.parse(raw),
    db = serviceClient(),
    idempotencyKey = `public-booking:${idempotency}`,
    requestHash = hash(JSON.stringify(raw));
  const { data: existing } = await db
    .from("idempotency_keys")
    .select("request_hash,response")
    .eq("key", idempotencyKey)
    .maybeSingle();
  if (existing) {
    if (existing.request_hash !== requestHash)
      throw new Error(
        "VALIDATION_FAILED: Idempotency key was reused with different booking details.",
      );
    if (existing.response) return existing.response;
    throw new Error("BOOKING_PROCESSING");
  }
  const { error: claimError } = await db
    .from("idempotency_keys")
    .insert({
      key: idempotencyKey,
      command: "public_booking",
      request_hash: requestHash,
      response: null,
    });
  if (claimError) {
    const { data: claimed } = await db
      .from("idempotency_keys")
      .select("response")
      .eq("key", idempotencyKey)
      .maybeSingle();
    if (claimed?.response) return claimed.response;
    throw new Error("BOOKING_PROCESSING");
  }
  const finish = async (result: Record<string, unknown>) => {
    await db
      .from("idempotency_keys")
      .update({ response: result })
      .eq("key", idempotencyKey);
    return result;
  };
  let createdHoldIds: string[] = [],
    createdBookingId: string | undefined,
    createdSeriesId: string | undefined,
    createdCheckoutId: string | undefined,
    claimedDiscountId: string | undefined;
  try {
    const studioId = await publicStudioId(db),
      { data: service, error: serviceError } = await db
        .from("booking_services")
        .select("*")
        .eq("id", input.serviceId)
        .eq("studio_id", studioId)
        .eq("published", true)
        .single();
    if (serviceError || !service)
      throw new Error("VALIDATION_FAILED: Service is unavailable.");
    const { data: studio, error: studioError } = await db
      .from("studios")
      .select("timezone,settings")
      .eq("id", studioId)
      .single();
    if (studioError || !studio)
      throw studioError || new Error("SERVICE_NOT_FOUND");
    const bookingTimezone = studio.timezone || "America/New_York";
    const preferences = studio.settings?.bookingDefaults || {};
    if (preferences.requirePhone && !input.guestPhone)
      throw new Error(
        "VALIDATION_FAILED: A phone number is required for this studio.",
      );
    if (
      preferences.allowRecurring === false &&
      service.category === "private" &&
      input.recurrence !== "none"
    )
      throw new Error(
        "VALIDATION_FAILED: Recurring booking is not currently available.",
      );
    if (
      preferences.allowPayLater === false &&
      input.paymentPolicy === "pay_later"
    )
      throw new Error(
        "VALIDATION_FAILED: Pay later is not currently available.",
      );
    if (
      !service.location_options.includes(input.location) ||
      !service.payment_policies.includes(input.paymentPolicy) ||
      !service.recurrence_options.includes(input.recurrence) ||
      (service.category === "group_class" && input.recurrence !== "none") ||
      (input.paymentPolicy === "deposit" && Number(service.deposit_minor) <= 0)
    )
      throw new Error(
        "VALIDATION_FAILED: This service does not support that option.",
      );
    const start = new Date(input.startsAt),
      end = new Date(input.endsAt),
      expectedEnd = start.getTime() + Number(service.duration_minutes) * 60000;
    if (
      Math.abs(end.getTime() - expectedEnd) > 1000 ||
      start.getTime() >
        Date.now() + Number(service.booking_horizon_days) * 86400000
    )
      throw new Error(
        "VALIDATION_FAILED: The requested time is outside this service's booking rules.",
      );
    let offeringOccurrenceCount = 1;
    if (input.offeringId) {
      const { data: offering, error: offeringError } = await db
        .from("service_offerings")
        .select(
          "id,starts_at,enrollment_closes_at,capacity,enrolled,lesson_ids",
        )
        .eq("id", input.offeringId)
        .eq("service_id", service.id)
        .eq("published", true)
        .single();
      if (
        offeringError ||
        !offering ||
        new Date(offering.enrollment_closes_at) <= new Date() ||
        new Date(offering.starts_at).getTime() !== start.getTime() ||
        offering.enrolled >= offering.capacity
      )
        throw new Error("OFFERING_FULL");
      offeringOccurrenceCount = Math.max(1, offering.lesson_ids?.length || 1);
    }
    const occurrenceCount =
      input.offeringId && service.category === "course"
        ? offeringOccurrenceCount
        : input.recurrence === "none" || service.category !== "private"
          ? 1
          : input.occurrenceCount || 6;
    if (!input.offeringId) {
      const availabilityUrl = new URL(request.url);
      availabilityUrl.searchParams.set("serviceId", service.id);
      availabilityUrl.searchParams.set(
        "from",
        new Date(
          Math.max(Date.now(), start.getTime() - 86400000),
        ).toISOString(),
      );
      const available = await availability(availabilityUrl);
      if (
        !available.some(
          (slot) =>
            slot.startsAt === input.startsAt && slot.endsAt === input.endsAt,
        )
      )
        throw new Error("SLOT_UNAVAILABLE");
    }
    if (input.paymentPolicy === "credits") {
      const authenticated = userClient(request);
      const {
        data: { user },
        error: userError,
      } = await authenticated.auth.getUser();
      if (userError || !user)
        throw new Error("FORBIDDEN: Sign in to use lesson credits.");
      const { data: student } = await authenticated
        .from("students")
        .select("id,email")
        .eq("studio_id", service.studio_id)
        .ilike("email", input.guestEmail)
        .single();
      if (!student)
        throw new Error(
          "FORBIDDEN: This sign-in is not linked to the student being booked.",
        );
      const { data: packages } = await db
        .from("packages")
        .select("id")
        .eq("student_id", student.id);
      let available = false;
      for (const item of packages || []) {
        const { data: balance } = await db.rpc("package_credit_balance", {
          target_package: item.id,
        });
        if (Number(balance) >= occurrenceCount) {
          available = true;
          break;
        }
      }
      if (!available)
        throw new Error(
          "VALIDATION_FAILED: No sufficient lesson credit balance is available.",
        );
    }
    const occurrenceStarts =
        input.offeringId || input.recurrence === "none"
          ? [input.startsAt]
          : recurringDates(
              input.startsAt,
              input.recurrence,
              occurrenceCount,
              bookingTimezone,
            ),
      lastEnd = new Date(
        new Date(occurrenceStarts.at(-1)!).getTime() +
          Number(service.duration_minutes) * 60000,
      ).toISOString();
    if (occurrenceStarts.length > 1) {
      const [
        { data: rules, error: ruleError },
        { data: exceptions, error: exceptionError },
      ] = await Promise.all([
        db
          .from("availability_rules")
          .select("weekday,starts_at_local,ends_at_local,timezone")
          .eq("studio_id", studioId)
          .or(`service_id.is.null,service_id.eq.${service.id}`)
          .eq("active", true),
        db
          .from("availability_exceptions")
          .select("starts_at,ends_at,kind")
          .eq("studio_id", studioId)
          .or(`service_id.is.null,service_id.eq.${service.id}`)
          .gte("ends_at", occurrenceStarts[0])
          .lte("starts_at", lastEnd),
      ]);
      if (ruleError || exceptionError) throw ruleError || exceptionError;
      for (const value of occurrenceStarts) {
        const occurrenceEnd = new Date(
            new Date(value).getTime() +
              Number(service.duration_minutes) * 60000,
          ).getTime(),
          withinRule = (rules || []).some((rule) => {
            const local = localSlot(value, rule.timezone);
            return (
              local.weekday === rule.weekday &&
              local.minutes >= timeMinutes(rule.starts_at_local) &&
              local.minutes + Number(service.duration_minutes) <=
                timeMinutes(rule.ends_at_local)
            );
          }),
          blocked = (exceptions || []).some(
            (item) =>
              item.kind === "unavailable" &&
              overlaps(
                new Date(value).getTime(),
                occurrenceEnd,
                new Date(item.starts_at).getTime(),
                new Date(item.ends_at).getTime(),
              ),
          );
        if (!withinRule || blocked) throw new Error("SLOT_UNAVAILABLE");
      }
    }
    if (!input.offeringId) {
      const googleToken = await googleAccessToken(),
        busy = await googleFreeBusy(googleToken, start.toISOString(), lastEnd);
      if (
        occurrenceStarts.some((value) => {
          const occurrenceStart = new Date(value).getTime(),
            occurrenceEnd =
              occurrenceStart + Number(service.duration_minutes) * 60000;
          return busy.some((block) =>
            overlaps(
              occurrenceStart,
              occurrenceEnd,
              new Date(block.start).getTime(),
              new Date(block.end).getTime(),
            ),
          );
        })
      )
        throw new Error("SLOT_UNAVAILABLE");
    }
    let hold: { id: string; expires_at?: string };
    if (occurrenceStarts.length > 1) {
      const { data: ids, error: holdError } = await db.rpc(
        "create_booking_series_holds",
        { target_service: input.serviceId, target_starts: occurrenceStarts },
      );
      if (holdError || !ids?.length)
        throw holdError || new Error("SLOT_UNAVAILABLE");
      createdHoldIds = ids;
      const { data: first } = await db
        .from("booking_holds")
        .select("id,expires_at")
        .eq("id", ids[0])
        .single();
      hold = first!;
    } else {
      const { data: first, error: holdError } = await db.rpc(
        "create_booking_hold",
        {
          target_service: input.serviceId,
          target_offering: input.offeringId || null,
          target_start: input.startsAt,
          target_end: input.endsAt,
        },
      );
      if (holdError) throw holdError;
      hold = first;
      createdHoldIds = [first.id];
    }
    let seriesId: string | undefined;
    if (service.category === "private" && input.recurrence !== "none") {
      const { data: series, error } = await db
        .from("recurring_series")
        .insert({
          studio_id: service.studio_id,
          service_id: service.id,
          kind: input.paymentPolicy === "subscription" ? "ongoing" : "fixed",
          cadence: input.recurrence,
          status: "active",
          starts_on: input.startsAt,
          occurrence_count:
            input.paymentPolicy === "subscription" ? null : occurrenceCount,
          payment_policy: input.paymentPolicy,
        })
        .select("id")
        .single();
      if (error) throw error;
      seriesId = series.id;
      createdSeriesId = series.id;
    }
    const locationUpcharge = Number(
        service.location_price_adjustments?.[input.location] ??
          (input.location === "in_person"
            ? studio.settings?.bookingDefaults?.inPersonUpchargeMinor
            : 0) ??
          0,
      ),
      unitPrice = Number(service.price_minor) + locationUpcharge,
      subtotalMinor =
        service.category === "private" &&
        input.recurrence !== "none" &&
        input.paymentPolicy !== "subscription"
          ? unitPrice * occurrenceCount
          : unitPrice;
    let discountMinor = 0;
    if (input.discountCode) {
      const { data: discount, error: discountError } = await db.rpc(
        "claim_booking_discount",
        {
          target_studio: service.studio_id,
          target_service: service.id,
          target_code: input.discountCode,
          target_subtotal: subtotalMinor,
        },
      );
      if (discountError || !discount?.length)
        throw new Error(
          "VALIDATION_FAILED: This discount code is invalid, expired, or unavailable.",
        );
      claimedDiscountId = discount[0].code_id;
      discountMinor = Number(discount[0].discount_minor || 0);
    }
    const totalMinor = Math.max(0, subtotalMinor - discountMinor),
      billingCount =
        input.paymentPolicy === "installments" ? occurrenceCount : 1,
      installmentUnit =
        input.paymentPolicy === "installments"
          ? Math.floor(totalMinor / billingCount)
          : Math.max(
              0,
              unitPrice -
                (input.paymentPolicy === "subscription" ? discountMinor : 0),
            ),
      installmentRemainder =
        input.paymentPolicy === "installments"
          ? totalMinor - installmentUnit * billingCount
          : 0;
    const depositAmount = Math.min(
        totalMinor,
        service.deposit_type === "full"
          ? totalMinor
          : service.deposit_type === "percentage"
            ? Math.round(
                (totalMinor * Number(service.deposit_percentage || 0)) / 100,
              )
            : Number(service.deposit_minor),
      ),
      manageToken = randomBytes(32).toString("base64url"),
      bookingReference = reference(),
      immediate =
        totalMinor === 0 ||
        ["pay_later", "credits"].includes(input.paymentPolicy),
      initialCharge =
        input.paymentPolicy === "deposit"
          ? depositAmount
          : input.paymentPolicy === "pay_now"
            ? totalMinor
            : input.paymentPolicy === "installments"
              ? installmentUnit
              : Math.max(0, unitPrice - discountMinor),
      balanceDueAt =
        service.balance_due_timing === "before_start"
          ? new Date(
              start.getTime() -
                Number(service.balance_due_hours || 0) * 3600000,
            ).toISOString()
          : null;
    const acceptedByName = input.forMinor
        ? input.guardianName!
        : input.guestName,
      acceptedByEmail = input.forMinor
        ? input.guardianEmail!
        : input.guestEmail,
      acceptedAt = new Date().toISOString();
    const { data: booking, error: bookingError } = await db
      .from("bookings")
      .insert({
        studio_id: service.studio_id,
        reference: bookingReference,
        service_id: service.id,
        offering_id: input.offeringId || null,
        series_id: seriesId,
        guest_name: input.guestName,
        guest_email: input.guestEmail,
        guest_phone: input.guestPhone || null,
        guardian_name: input.guardianName || null,
        guardian_email: input.guardianEmail || null,
        for_minor: input.forMinor,
        portal_requested: input.createPortalProfile,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        timezone: bookingTimezone,
        location: input.location,
        status: immediate ? "held" : "pending_payment",
        payment_policy: input.paymentPolicy,
        payment_status: immediate ? "due" : "processing",
        total_minor: totalMinor,
        paid_minor: 0,
        discount_code_id: claimedDiscountId || null,
        discount_minor: discountMinor,
        currency: service.currency,
        policy_snapshot: {
          ...service.policy,
          policyVersion: service.policy_version,
        },
        pricing_snapshot: {
          basePriceMinor: Number(service.price_minor),
          locationUpchargeMinor: locationUpcharge,
          unitPriceMinor: unitPrice,
          subtotalMinor,
          discountMinor,
          discountCode: input.discountCode || null,
          depositType: service.deposit_type,
          depositAmountMinor: depositAmount,
          balanceDueTiming: service.balance_due_timing,
        },
        balance_due_at: balanceDueAt,
        auto_charge_balance: Boolean(service.auto_charge_balance),
        manage_token_hash: hash(manageToken),
        hold_ids: createdHoldIds,
        installment_count:
          input.paymentPolicy === "installments" ? billingCount : null,
        installment_remainder_minor: installmentRemainder,
        terms_version: TERMS_VERSION,
        terms_accepted_at: acceptedAt,
        terms_accepted_by_name: acceptedByName,
      })
      .select("id,reference")
      .single();
    if (bookingError) throw bookingError;
    createdBookingId = booking.id;
    if (claimedDiscountId) {
      const { error: redemptionError } = await db
        .from("discount_redemptions")
        .insert({
          discount_code_id: claimedDiscountId,
          booking_id: booking.id,
          amount_minor: discountMinor,
        });
      if (redemptionError) throw redemptionError;
    }
    const { error: termsError } = await db
      .from("terms_acceptances")
      .insert({
        studio_id: service.studio_id,
        booking_id: booking.id,
        version: TERMS_VERSION,
        accepted_by_name: acceptedByName,
        accepted_by_email: acceptedByEmail,
        accepted_as_guardian: input.forMinor,
        accepted_at: acceptedAt,
        ip_hash: hash(
          request.headers.get("x-nf-client-connection-ip") ||
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            "unknown",
        ),
        user_agent: (request.headers.get("user-agent") || "").slice(0, 500),
      });
    if (termsError) throw termsError;
    if (immediate) {
      const { error } = await db.rpc("confirm_booking", {
        target_booking: booking.id,
        target_hold: hold.id,
        amount_paid: 0,
        provider_reference: `invoice:${booking.id}`,
      });
      if (error) throw error;
      await queueBookingEmails(
        db,
        booking.id,
        manageToken,
        new URL(request.url).origin,
      );
      try {
        await ensureBookingPortalAccess(
          db,
          booking.id,
          new URL(request.url).origin,
        );
      } catch (inviteError) {
        await db
          .from("recommendations")
          .upsert(
            {
              studio_id: service.studio_id,
              entity_type: "booking",
              entity_id: booking.id,
              reason_code: "portal_invitation_failed",
              title: "Portal invitation needs retry",
              explanation:
                "The booking is confirmed, but Supabase could not send or link portal access.",
              evidence: [String(inviteError)],
              urgency: 4,
              suggested_action: "retry_portal_invitation",
              requires_confirmation: false,
              status: "open",
              dedupe_key: `booking:${booking.id}:portal-invite`,
            },
            { onConflict: "dedupe_key" },
          );
      }
      return await finish({
        bookingId: booking.id,
        reference: booking.reference,
        status: "confirmed",
        manageUrl: `/booking/${manageToken}`,
      });
    }
    const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("Stripe is not configured.");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-07-29.dahlia" }),
      origin = new URL(request.url).origin,
      recurring = ["subscription", "installments"].includes(
        input.paymentPolicy,
      );
    const session = await stripe.checkout.sessions.create(
      {
        mode: recurring ? "subscription" : "payment",
        integration_identifier: integrationIdentifier(),
        customer_email: input.guardianEmail || input.guestEmail,
        line_items: [
          {
            price_data: {
              currency: service.currency.toLowerCase(),
              unit_amount: initialCharge,
              product_data: {
                name: service.name,
                description: `${service.duration_minutes} minute ${service.category.replaceAll("_", " ")}`,
              },
              ...(recurring
                ? {
                    recurring: {
                      interval: "week" as const,
                      interval_count: input.recurrence === "biweekly" ? 2 : 1,
                    },
                  }
                : {}),
            },
            quantity: 1,
          },
        ],
        success_url: `${origin}/booking/${manageToken}?checkout=processing`,
        cancel_url: `${origin}/book/${service.slug}?checkout=cancelled`,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
        client_reference_id: booking.id,
        metadata: {
          booking_id: booking.id,
          hold_id: hold.id,
          manage_token: manageToken,
          idempotency_key: idempotency,
          ...(input.paymentPolicy === "installments"
            ? { installment_count: String(input.occurrenceCount || 6) }
            : {}),
        },
        subscription_data: recurring
          ? {
              metadata: {
                booking_id: booking.id,
                hold_id: hold.id,
                series_id: seriesId || "",
                manage_token: manageToken,
                payment_policy: input.paymentPolicy,
                installment_count: String(input.occurrenceCount || 0),
              },
            }
          : undefined,
      },
      { idempotencyKey: idempotency },
    );
    createdCheckoutId = session.id;
    await Promise.all([
      db
        .from("bookings")
        .update({ stripe_checkout_session_id: session.id })
        .eq("id", booking.id),
      db
        .from("booking_holds")
        .update({ checkout_session_id: session.id })
        .eq("id", hold.id),
    ]);
    return await finish({
      bookingId: booking.id,
      reference: booking.reference,
      status: "pending_payment",
      checkoutUrl: session.url,
      expiresAt: hold.expires_at,
    });
  } catch (error) {
    if (createdCheckoutId) {
      try {
        const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
        if (stripeKey)
          await new Stripe(stripeKey, {
            apiVersion: "2026-07-29.dahlia",
          }).checkout.sessions.expire(createdCheckoutId);
      } catch {}
    }
    if (createdBookingId)
      await db.from("bookings").delete().eq("id", createdBookingId);
    if (claimedDiscountId)
      await db.rpc("release_booking_discount", {
        target_code: claimedDiscountId,
      });
    if (createdSeriesId)
      await db.from("recurring_series").delete().eq("id", createdSeriesId);
    if (createdHoldIds.length)
      await db
        .from("booking_holds")
        .update({ status: "expired" })
        .in("id", createdHoldIds);
    await db
      .from("idempotency_keys")
      .delete()
      .eq("key", idempotencyKey)
      .is("response", null);
    throw error;
  }
}

async function rateLimit(request: Request, action: string) {
  const address =
      request.headers.get("x-nf-client-connection-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown",
    limits: Record<string, [number, number]> = {
      services: [120, 60],
      availability: [120, 60],
      holds: [10, 600],
      manage: [30, 60],
    },
    [limit, window] = limits[action] || [30, 60],
    key = `${action}:${hash(address)}`;
  const { data, error } = await serviceClient().rpc("claim_public_rate_limit", {
    target_key: key,
    target_limit: limit,
    target_window_seconds: window,
  });
  if (error) throw error;
  if (!data) throw new Error("RATE_LIMITED");
}
async function manage(url: URL, request: Request) {
  const token = url.searchParams.get("token") || "";
  if (token.length < 20) throw new Error("FORBIDDEN");
  const db = serviceClient();
  const { data: booking, error } = await db
    .from("bookings")
    .select(
      "id,reference,studio_id,service_id,offering_id,student_id,starts_at,ends_at,timezone,location,status,payment_policy,payment_status,total_minor,paid_minor,currency,policy_snapshot,reschedule_count,guest_name,version,stripe_checkout_session_id",
    )
    .eq("manage_token_hash", hash(token))
    .single();
  if (error || !booking) throw new Error("FORBIDDEN");
  if (request.method === "GET") return booking;
  const body = (await request.json()) as {
    command?: string;
    startsAt?: string;
    endsAt?: string;
    scope?: "occurrence" | "series";
  };
  if (body.command === "cancel") {
    const result = await cancelConfirmedBooking({
      db,
      booking,
      correlationId: `token-cancel:${booking.id}:${booking.version}`,
      stripeIdempotencyPrefix: "public-cancel",
    });
    return result.booking;
  }
  if (
    body.command === "reschedule" &&
    body.startsAt &&
    body.endsAt &&
    booking.reschedule_count < Number(booking.policy_snapshot.rescheduleLimit)
  ) {
    if (
      new Date(booking.starts_at).getTime() - Date.now() <
      Number(booking.policy_snapshot.cancellationWindowHours) * 3600000
    )
      throw new Error(
        `VALIDATION_FAILED: Online rescheduling closes ${booking.policy_snapshot.cancellationWindowHours} hours before the lesson. Contact the studio if you need help.`,
      );
    const { data: participants } = await db
        .from("lesson_participants")
        .select("lesson_id")
        .eq("booking_id", booking.id),
      lessonIds = (participants || []).map((item) => item.lesson_id),
      { data: lessons } = lessonIds.length
        ? await db
            .from("lessons")
            .select("starts_at,ends_at")
            .in("id", lessonIds)
            .order("starts_at")
        : { data: [] },
      shift =
        new Date(body.startsAt).getTime() -
        new Date(booking.starts_at).getTime(),
      targets =
        body.scope === "series" ? lessons || [] : (lessons || []).slice(0, 1);
    if (!targets.length) throw new Error("INVALID_TRANSITION");
    const shifted = targets.map((lesson) => ({
        start: new Date(
          new Date(lesson.starts_at).getTime() + shift,
        ).toISOString(),
        end: new Date(new Date(lesson.ends_at).getTime() + shift).toISOString(),
      })),
      googleToken = await googleAccessToken(),
      busy = await googleFreeBusy(
        googleToken,
        shifted[0].start,
        shifted.at(-1)!.end,
      );
    if (
      shifted.some((item) =>
        busy.some((block) =>
          overlaps(
            new Date(item.start).getTime(),
            new Date(item.end).getTime(),
            new Date(block.start).getTime(),
            new Date(block.end).getTime(),
          ),
        ),
      )
    )
      throw new Error("SLOT_UNAVAILABLE");
    const { data: hold, error: holdError } = await db.rpc(
      "create_booking_hold",
      {
        target_service: booking.service_id,
        target_offering: null,
        target_start: body.startsAt,
        target_end: body.endsAt,
      },
    );
    if (holdError) throw holdError;
    const { data, error: updateError } = await db.rpc(
      "reschedule_booking_occurrences",
      {
        target_booking: booking.id,
        expected_version: booking.version,
        next_start: body.startsAt,
        next_end: body.endsAt,
        change_scope: body.scope || "occurrence",
      },
    );
    if (updateError) {
      await db
        .from("booking_holds")
        .update({ status: "expired" })
        .eq("id", hold.id);
      throw updateError;
    }
    await db
      .from("booking_holds")
      .update({ status: "converted" })
      .eq("id", hold.id);
    return data;
  }
  throw new Error(
    "VALIDATION_FAILED: Change is not permitted by this booking policy.",
  );
}

export default async (request: Request, context: Context) => {
  const id = correlationId(request, context.requestId);
  try {
    const action = context.params.action,
      url = new URL(request.url);
    await rateLimit(request, action);
    if (action === "services" && request.method === "GET")
      return json(await publicServices(), 200, {
        "Cache-Control": "no-store",
        "Netlify-CDN-Cache-Control":
          "public, max-age=15, stale-while-revalidate=60",
      });
    if (action === "availability" && request.method === "GET")
      return json({ slots: await availability(url) });
    if (action === "holds" && request.method === "POST")
      return json(await createBooking(request), 201);
    if (
      action === "manage" &&
      (request.method === "GET" || request.method === "POST")
    )
      return json(await manage(url, request));
    return json(
      {
        code: "NOT_FOUND",
        message: "Unknown booking endpoint.",
        retryable: false,
        correlationId: id,
      },
      404,
    );
  } catch (error) {
    return apiError(error, id);
  }
};
export const config: Config = { path: "/api/v2/public/booking/:action" };
