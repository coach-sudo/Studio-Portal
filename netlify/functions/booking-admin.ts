import type { Config, Context } from "@netlify/functions";
import Stripe from "stripe";
import { AppError, apiError, correlationId, json } from "./_shared/http";
import { bookingAdminCommandSchema } from "./_shared/schemas";
import { serviceClient, userClient } from "./_shared/supabase";
import { googleAccessToken, googleCalendarConflicts } from "./_shared/google";
import { studioOverlapPolicy } from "../../src/domain/schedulingConflicts";

const resources: Record<string, string> = {
  services: "booking_services",
  availability: "availability_rules",
  exceptions: "availability_exceptions",
  offerings: "service_offerings",
  bookings: "bookings",
  series: "recurring_series",
  participants: "lesson_participants",
};
async function googleObservation(startsAt: string, endsAt: string) {
  if (!Netlify.env.get("GOOGLE_REFRESH_TOKEN"))
    return { conflicts: [], checked: false };
  try {
    return {
      conflicts: await googleCalendarConflicts(
        await googleAccessToken(),
        startsAt,
        endsAt,
      ),
      checked: true,
    };
  } catch {
    throw new AppError("CALENDAR_UNAVAILABLE", {
      status: 503,
      message:
        "Google conflict checks are unavailable. Reconnect Google and retry. Nothing was changed.",
      retryable: true,
    });
  }
}

export default async (request: Request, context: Context) => {
  const id = correlationId(request, context.requestId);
  try {
    const resource = context.params.resource;
    const table = resources[resource];
    if (!table)
      return json(
        {
          code: "NOT_FOUND",
          message: "Unknown booking resource.",
          retryable: false,
          correlationId: id,
        },
        404,
      );
    const db = userClient(request);
    if (request.method === "GET") {
      let query = db.from(table).select("*");
      if (resource === "bookings")
        query = query.order("starts_at", { ascending: true });
      const { data, error } = await query;
      if (error) throw error;
      return json({ [resource]: data });
    }
    if (request.method !== "POST")
      return json(
        {
          code: "METHOD_NOT_ALLOWED",
          message: "Method not allowed.",
          retryable: false,
          correlationId: id,
        },
        405,
      );
    const body = bookingAdminCommandSchema.parse(await request.json());

    if (
      resource === "bookings" &&
      body.command === "check_conflicts" &&
      body.payload
    ) {
      const { data: membership, error: membershipError } = await db
        .from("memberships")
        .select("studio_id")
        .eq("role", "coach")
        .limit(1)
        .single();
      if (membershipError || !membership) throw new Error("FORBIDDEN");
      const startsAt = new Date(String(body.payload.starts_at || ""));
      const endsAt = new Date(String(body.payload.ends_at || ""));
      if (
        !Number.isFinite(startsAt.getTime()) ||
        !Number.isFinite(endsAt.getTime()) ||
        endsAt <= startsAt
      )
        throw new Error(
          "VALIDATION_FAILED: Choose a valid start and end time.",
        );
      let target: { status: string; offeringId?: string | null } | undefined;
      if (body.payload.lesson_id) {
        const { data: lesson, error } = await db
          .from("lessons")
          .select("id,status,offering_id")
          .eq("studio_id", membership.studio_id)
          .eq("id", String(body.payload.lesson_id))
          .maybeSingle();
        if (error) throw error;
        if (!lesson) throw new Error("FORBIDDEN");
        target = { status: lesson.status, offeringId: lesson.offering_id };
      }
      const { data: localRows, error: localError } = await db
        .from("lessons")
        .select("id,topic,starts_at,ends_at,status,offering_id")
        .eq("studio_id", membership.studio_id)
        .in("status", ["draft", "scheduled"])
        .lt("starts_at", endsAt.toISOString())
        .gt("ends_at", startsAt.toISOString());
      if (localError) throw localError;
      const local = (localRows || [])
        .filter((item) => item.id !== body.payload?.lesson_id)
        .map((item) => {
          const policy = studioOverlapPolicy(target, {
            status: item.status,
            offeringId: item.offering_id,
          });
          return {
            id: item.id,
            summary: item.topic || "Studio lesson",
            start: item.starts_at,
            end: item.ends_at,
            source: "studio",
            policy,
            blocksChange: policy === "private_overlap",
          };
        });
      const observation =
        body.payload.historical === true
          ? { conflicts: [], checked: false }
          : await googleObservation(
              startsAt.toISOString(),
              endsAt.toISOString(),
            );
      const google = observation.conflicts.map((item) => ({
        ...item,
        source: "google",
        policy: "google_busy",
        blocksChange: false,
      }));
      const seen = new Set<string>();
      const conflicts = [...local, ...google].filter((item) => {
        const key = `${item.source}|${item.id}|${item.start}|${item.end}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return json({
        resource: {
          conflicts,
          externalCalendarChecked: observation.checked,
        },
      });
    }

    if (resource === "bookings" && body.command === "create_manual") {
      const key = request.headers.get("Idempotency-Key");
      if (!key || key.length < 8 || key.length > 200)
        throw new AppError("VALIDATION_FAILED", {
          status: 422,
          message:
            "A stable booking request key is required. Reopen the booking form.",
        });
      const { data: membership, error: membershipError } = await db
        .from("memberships")
        .select("studio_id")
        .eq("role", "coach")
        .limit(1)
        .single();
      if (membershipError || !membership) throw new Error("FORBIDDEN");
      const replay = await db.rpc("manual_booking_replay", {
        p_key: key,
        p_value: body.payload,
      });
      if (replay.error) throw replay.error;
      if (replay.data) return json(replay.data, 201);
      const { data: serviceRow, error: serviceError } = await db
        .from("booking_services")
        .select("duration_minutes,default_location")
        .eq("id", String(body.payload.service_id || ""))
        .eq("studio_id", membership.studio_id)
        .single();
      if (serviceError || !serviceRow)
        throw new Error("VALIDATION_FAILED: Choose a booking service.");
      const startsAt = new Date(String(body.payload.starts_at || ""));
      const endsAt = new Date(
        startsAt.getTime() + Number(serviceRow.duration_minutes) * 60000,
      );
      if (
        !Number.isFinite(startsAt.getTime()) ||
        !Number.isFinite(endsAt.getTime()) ||
        (startsAt <= new Date() && body.payload.historical !== true)
      )
        throw new Error(
          "VALIDATION_FAILED: Choose a valid time and use Record Past Lesson for history.",
        );
      let external = "not_configured";
      if (startsAt <= new Date()) external = "not_checked";
      else if (
        body.payload.allow_conflict &&
        Netlify.env.get("GOOGLE_REFRESH_TOKEN")
      )
        external = "overridden";
      else if (Netlify.env.get("GOOGLE_REFRESH_TOKEN")) {
        const { conflicts } = await googleObservation(
          startsAt.toISOString(),
          endsAt.toISOString(),
        );
        if (conflicts.length)
          throw new AppError("SLOT_UNAVAILABLE", {
            status: 409,
            message:
              "Review the Google conflict or choose another time. Studio lesson overlaps cannot be overridden.",
          });
        external = "checked";
      }
      const created = await db.rpc("command_create_manual_booking", {
        p_key: key,
        p_value: body.payload,
        p_external_status: external,
      });
      if (created.error) throw created.error;
      return json(created.data, 201);
    }

    if (
      resource === "offerings" &&
      body.command === "create_offering" &&
      body.payload
    ) {
      const { data, error } = await db.rpc("command_create_service_offering", {
        target_service: body.payload.service_id,
        offering_title: body.payload.title,
        first_start: body.payload.starts_at,
        enrollment_closes: body.payload.enrollment_closes_at,
        seat_capacity: body.payload.capacity,
        occurrence_total: body.payload.occurrence_count,
        publish_now: body.payload.published,
      });
      if (error) throw error;
      const { data: enriched, error: enrichError } = await db
        .from("service_offerings")
        .update({
          description: String(body.payload.description || ""),
          meeting_url: body.payload.meeting_url || null,
          resource_links: Array.isArray(body.payload.resource_links)
            ? body.payload.resource_links
            : [],
        })
        .eq("id", data.id)
        .select()
        .single();
      if (enrichError) throw enrichError;
      return json({ resource: enriched }, 201);
    }

    if (
      resource === "offerings" &&
      body.command === "delete" &&
      body.id &&
      body.expectedVersion
    ) {
      const { data: offering, error: offeringError } = await db
        .from("service_offerings")
        .select("*")
        .eq("id", body.id)
        .single();
      if (offeringError || !offering) throw new Error("FORBIDDEN");
      if (offering.version !== body.expectedVersion)
        throw new Error(`VERSION_CONFLICT:${body.expectedVersion}`);
      const { count } = await db
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("offering_id", offering.id)
        .not("status", "in", "(cancelled,expired)");
      if ((count || 0) > 0 || offering.enrolled > 0)
        throw new Error(
          "VALIDATION_FAILED: Cancel or move active enrollments before deleting this offering.",
        );
      const service = serviceClient();
      if (offering.lesson_ids?.length)
        throw new Error(
          "REVIEW_REQUIRED: Classes with lesson history must use reviewed occurrence changes. Safe deletion will be available through bulk management.",
        );
      const linked = await service
        .from("lessons")
        .select("id")
        .eq("offering_id", offering.id)
        .limit(1);
      if (linked.error) throw linked.error;
      if (linked.data?.length)
        throw new Error("REVIEW_REQUIRED: This class has lesson history.");
      const { error } = await service
        .from("service_offerings")
        .delete()
        .eq("id", offering.id)
        .eq("version", offering.version);
      if (error) throw error;
      return json({ resource: { id: offering.id, deleted: true } });
    }

    if (
      resource === "bookings" &&
      body.command === "confirm_location" &&
      body.id &&
      body.expectedVersion &&
      body.payload?.location
    ) {
      const { data: visible, error: visibleError } = await db
        .from("bookings")
        .select("*")
        .eq("id", body.id)
        .single();
      if (visibleError || !visible) throw new Error("FORBIDDEN");
      if (visible.version !== body.expectedVersion)
        throw new Error(`VERSION_CONFLICT:${body.expectedVersion}`);
      if (visible.location !== "in_person")
        throw new Error(
          "VALIDATION_FAILED: Only in-person bookings use a confirmed address.",
        );
      const service = serviceClient(),
        confirmedAt = new Date().toISOString(),
        { data, error } = await service
          .from("bookings")
          .update({
            in_person_location: String(body.payload.location).trim(),
            location_confirmed_at: confirmedAt,
            version: visible.version + 1,
            updated_at: confirmedAt,
          })
          .eq("id", visible.id)
          .eq("version", visible.version)
          .select()
          .single();
      if (error) throw error;
      const { data: participants } = await service
          .from("lesson_participants")
          .select("lesson_id")
          .eq("booking_id", visible.id),
        lessonIds = (participants || []).map((item) => item.lesson_id);
      if (lessonIds.length)
        await Promise.all([
          service
            .from("lessons")
            .update({
              location_label: String(body.payload.location).trim(),
              updated_at: confirmedAt,
            })
            .in("id", lessonIds),
          service
            .from("calendar_projections")
            .update({ status: "queued", last_error: null })
            .in("lesson_id", lessonIds),
        ]);
      await service.from("audit_events").insert({
        studio_id: visible.studio_id,
        entity_type: "booking",
        entity_id: visible.id,
        action: "booking.location_confirmed",
        reason: "Coach confirmed in-person location",
        correlation_id: id,
        source: "booking_admin",
        before_state: visible,
        after_state: data,
      });
      return json({ resource: data });
    }

    if (
      resource === "bookings" &&
      body.id &&
      ["cancel", "refund"].includes(body.command)
    ) {
      const { data: visible, error: visibleError } = await db
        .from("bookings")
        .select("*")
        .eq("id", body.id)
        .single();
      if (visibleError || !visible) throw new Error("FORBIDDEN");
      if (!body.expectedVersion || visible.version !== body.expectedVersion)
        throw new Error(`VERSION_CONFLICT:${body.expectedVersion ?? 0}`);
      if (body.command === "cancel" && visible.status !== "confirmed")
        throw new Error("INVALID_TRANSITION");
      const service = serviceClient();
      if (body.command === "cancel") {
        const { data, error } = await service.rpc("cancel_booking_credit", {
          p_booking: visible.id,
          p_version: body.expectedVersion,
          p_use: body.payload.useCredit === true,
          p_student_action: false,
        });
        if (error) throw error;
        return json({ resource: data.booking });
      }
      if (visible.paid_minor <= 0 || visible.payment_status === "refunded")
        throw new Error(
          "VALIDATION_FAILED: This booking has no refundable payment.",
        );
      const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) throw new Error("Stripe is not configured.");
      const stripe = new Stripe(stripeKey, { apiVersion: "2026-07-29.dahlia" });
      if (!visible.stripe_checkout_session_id)
        throw new Error(
          "VALIDATION_FAILED: No Stripe Checkout session is linked to this booking.",
        );
      const session = await stripe.checkout.sessions.retrieve(
        visible.stripe_checkout_session_id,
      );
      const paymentIntent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;
      if (!paymentIntent)
        throw new Error(
          "VALIDATION_FAILED: No Stripe payment is available to refund.",
        );
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntent,
          amount: visible.paid_minor,
          metadata: { booking_id: visible.id, correlation_id: id },
        },
        { idempotencyKey: `booking-refund:${visible.id}:${visible.version}` },
      );
      if (visible.student_id)
        await service.from("payment_entries").insert({
          student_id: visible.student_id,
          kind: "refund",
          amount_minor: visible.paid_minor,
          currency: visible.currency,
          external_reference: refund.id,
          reason: `Booking refund ${visible.reference}`,
        });
      const { data, error } = await service
        .from("bookings")
        .update({
          payment_status: "refunded",
          version: visible.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", visible.id)
        .eq("version", visible.version)
        .select()
        .single();
      if (error) throw error;
      await service.from("audit_events").insert({
        studio_id: visible.studio_id,
        entity_type: "booking",
        entity_id: visible.id,
        action: "booking.refunded",
        reason: "Coach issued refund",
        correlation_id: id,
        source: "booking_admin",
        before_state: visible,
        after_state: data,
      });
      return json({ resource: data });
    }

    if (
      resource === "series" &&
      body.command === "update" &&
      body.id &&
      body.expectedVersion &&
      body.payload?.status
    ) {
      const { data: visible, error: visibleError } = await db
        .from("recurring_series")
        .select("*")
        .eq("id", body.id)
        .single();
      if (visibleError || !visible) throw new Error("FORBIDDEN");
      if (visible.version !== body.expectedVersion)
        throw new Error(`VERSION_CONFLICT:${body.expectedVersion}`);
      const next = String(body.payload.status);
      if (
        ![
          "active",
          "paused",
          "cancel_at_period_end",
          "cancelled",
          "completed",
        ].includes(next)
      )
        throw new Error("INVALID_TRANSITION");
      const service = serviceClient();
      if (visible.stripe_subscription_id) {
        const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
        if (!stripeKey) throw new Error("Stripe is not configured.");
        const stripe = new Stripe(stripeKey, {
          apiVersion: "2026-07-29.dahlia",
        });
        if (next === "cancelled")
          await stripe.subscriptions.cancel(visible.stripe_subscription_id);
        else
          await stripe.subscriptions.update(
            visible.stripe_subscription_id,
            next === "paused"
              ? { pause_collection: { behavior: "void" } }
              : {
                  pause_collection: null,
                  cancel_at_period_end: next === "cancel_at_period_end",
                },
          );
      }
      if (next === "cancelled") {
        const { data: lessons } = await service
          .from("lessons")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("series_id", visible.id)
          .eq("status", "scheduled")
          .gt("starts_at", new Date().toISOString())
          .select("id");
        const ids = (lessons || []).map((item) => item.id);
        if (ids.length)
          await service
            .from("calendar_projections")
            .update({ status: "queued", last_error: null })
            .in("lesson_id", ids);
      }
      const { data, error } = await service
        .from("recurring_series")
        .update({
          status: next,
          version: visible.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", visible.id)
        .eq("version", visible.version)
        .select()
        .single();
      if (error) throw error;
      await service.from("audit_events").insert({
        studio_id: visible.studio_id,
        entity_type: "recurring_series",
        entity_id: visible.id,
        action: `series.${next}`,
        reason: "Coach changed recurring series",
        correlation_id: id,
        source: "booking_admin",
        before_state: visible,
        after_state: data,
      });
      return json({ resource: data });
    }

    if (
      resource === "bookings" &&
      ["create", "update", "delete"].includes(body.command)
    )
      throw new AppError("VALIDATION_FAILED", {
        status: 422,
        message:
          "Use a reviewed booking action. Direct booking changes cannot bypass lesson, payment and audit safeguards.",
      });

    if (!body.payload)
      throw new Error("VALIDATION_FAILED: payload is required.");
    if (resource === "services") {
      const locations = body.payload.location_options,
        payments = body.payload.payment_policies,
        recurrences = body.payload.recurrence_options;
      if (
        !Array.isArray(locations) ||
        !locations.length ||
        !Array.isArray(payments) ||
        !payments.length ||
        !Array.isArray(recurrences) ||
        !recurrences.length ||
        !locations.includes(body.payload.default_location) ||
        (payments.includes("deposit") &&
          Number(body.payload.deposit_minor) <= 0)
      )
        throw new Error(
          "VALIDATION_FAILED: Service delivery, recurrence, deposit, and payment settings are incomplete.",
        );
    }
    if (body.command === "create") {
      const { data, error } = await db
        .from(table)
        .insert(body.payload)
        .select()
        .single();
      if (error) throw error;
      return json({ resource: data }, 201);
    }
    if (body.command === "update" && body.id && body.expectedVersion) {
      const { data, error } = await db
        .from(table)
        .update({
          ...body.payload,
          version: body.expectedVersion + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.id)
        .eq("version", body.expectedVersion)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`VERSION_CONFLICT:${body.expectedVersion}`);
      return json({ resource: data });
    }
    if (body.command === "delete" && body.id && body.expectedVersion) {
      const { data: existing, error: readError } = await db
        .from(table)
        .select("id,version")
        .eq("id", body.id)
        .single();
      if (readError || !existing) throw new Error("FORBIDDEN");
      if (existing.version !== body.expectedVersion)
        throw new Error(`VERSION_CONFLICT:${body.expectedVersion}`);
      const { error } = await db
        .from(table)
        .delete()
        .eq("id", body.id)
        .eq("version", body.expectedVersion);
      if (error) throw error;
      return json({ resource: { id: body.id, deleted: true } });
    }
    throw new Error("VALIDATION_FAILED: Unsupported booking command.");
  } catch (error) {
    return apiError(error, id);
  }
};

export const config: Config = { path: "/api/v2/admin/booking/:resource" };
