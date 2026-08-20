import type { Config, Context } from "@netlify/functions";
import Stripe from "stripe";
import { createHash, randomBytes } from "node:crypto";
import { apiError, correlationId, json } from "./_shared/http";
import { serviceClient, userClient } from "./_shared/supabase";
import { queueBookingEmails } from "./_shared/booking-email";
import { ensureBookingPortalAccess } from "./_shared/portal-access";

const resources: Record<string, string> = {
  services: "booking_services",
  availability: "availability_rules",
  exceptions: "availability_exceptions",
  offerings: "service_offerings",
  bookings: "bookings",
  series: "recurring_series",
  participants: "lesson_participants",
};

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
    const body = (await request.json()) as {
      command?: string;
      id?: string;
      expectedVersion?: number;
      payload?: Record<string, any>;
    };
    if (!body.command)
      throw new Error("VALIDATION_FAILED: command is required.");

    if (
      resource === "bookings" &&
      body.command === "create_manual" &&
      body.payload
    ) {
      const { data: membership, error: membershipError } = await db
        .from("memberships")
        .select("studio_id")
        .eq("role", "coach")
        .limit(1)
        .single();
      if (membershipError || !membership) throw new Error("FORBIDDEN");
      const { data: student, error: studentError } = await db
        .from("students")
        .select("*")
        .eq("id", String(body.payload.student_id || ""))
        .eq("studio_id", membership.studio_id)
        .single();
      if (studentError || !student)
        throw new Error(
          "VALIDATION_FAILED: Choose a student from the studio roster.",
        );
      const { data: serviceRow, error: serviceError } = await db
        .from("booking_services")
        .select("*")
        .eq("id", String(body.payload.service_id || ""))
        .eq("studio_id", membership.studio_id)
        .single();
      if (serviceError || !serviceRow)
        throw new Error("VALIDATION_FAILED: Choose a booking service.");
      const startsAt = new Date(String(body.payload.starts_at || "")),
        endsAt = new Date(
          startsAt.getTime() + Number(serviceRow.duration_minutes) * 60000,
        ),
        location = String(body.payload.location || serviceRow.default_location);
      if (
        !Number.isFinite(startsAt.getTime()) ||
        startsAt <= new Date() ||
        !serviceRow.location_options.includes(location)
      )
        throw new Error(
          "VALIDATION_FAILED: Choose a future time and supported meeting format.",
        );
      const upcharge = Number(
          serviceRow.location_price_adjustments?.[location] || 0,
        ),
        totalMinor =
          body.payload.price_minor == null
            ? Number(serviceRow.price_minor) + upcharge
            : Number(body.payload.price_minor),
        paidMinor = body.payload.mark_paid ? totalMinor : 0,
        token = randomBytes(32).toString("base64url"),
        tokenHash = createHash("sha256").update(token).digest("hex"),
        reference = `SS-${randomBytes(4).toString("hex").toUpperCase()}`,
        service = serviceClient(),
        now = new Date().toISOString();
      let bookingId: string | undefined, lessonId: string | undefined;
      try {
        const { data: booking, error: bookingError } = await service
          .from("bookings")
          .insert({
            studio_id: membership.studio_id,
            reference,
            service_id: serviceRow.id,
            student_id: student.id,
            guest_name: student.full_name,
            guest_email: student.email || student.guardian_email,
            guardian_name: student.guardian_name,
            guardian_email: student.guardian_email,
            for_minor: student.is_minor,
            starts_at: startsAt.toISOString(),
            ends_at: endsAt.toISOString(),
            timezone: student.timezone || "America/New_York",
            location,
            status: "confirmed",
            payment_policy: "pay_later",
            payment_status: paidMinor ? "paid" : "due",
            total_minor: totalMinor,
            paid_minor: paidMinor,
            currency: serviceRow.currency,
            policy_snapshot: {
              ...serviceRow.policy,
              policyVersion: serviceRow.policy_version,
            },
            pricing_snapshot: {
              basePriceMinor: Number(serviceRow.price_minor),
              locationUpchargeMinor: upcharge,
              unitPriceMinor: totalMinor,
              adminOverride: true,
            },
            admin_override: {
              schedule: true,
              price: body.payload.price_minor != null,
              createdByCoach: true,
            },
            manage_token_hash: tokenHash,
          })
          .select()
          .single();
        if (bookingError) throw bookingError;
        bookingId = booking.id;
        const locationLabel =
            location === "in_person"
              ? String(
                  body.payload.location_label || "Location to be confirmed",
                )
              : "Google Meet pending",
          { data: lesson, error: lessonError } = await service
            .from("lessons")
            .insert({
              studio_id: membership.studio_id,
              student_id: student.id,
              topic: serviceRow.name,
              starts_at: startsAt.toISOString(),
              ends_at: endsAt.toISOString(),
              status: "scheduled",
              location_type: location === "in_person" ? "in_person" : "virtual",
              location_label: locationLabel,
              service_id: serviceRow.id,
              meeting_provider: location,
              capacity: 1,
            })
            .select()
            .single();
        if (lessonError) throw lessonError;
        lessonId = lesson.id;
        const [{ error: participantError }, { error: projectionError }] =
          await Promise.all([
            service.from("lesson_participants").insert({
              lesson_id: lesson.id,
              booking_id: booking.id,
              student_id: student.id,
              display_name: student.full_name,
              email: student.email || student.guardian_email,
              status: "confirmed",
            }),
            service
              .from("calendar_projections")
              .insert({ lesson_id: lesson.id, status: "queued" }),
          ]);
        if (participantError || projectionError)
          throw participantError || projectionError;
        if (paidMinor)
          await service.from("payment_entries").insert({
            student_id: student.id,
            kind: "payment",
            amount_minor: paidMinor,
            currency: serviceRow.currency,
            external_reference: `manual:${booking.id}`,
            reason: `Manual payment for ${reference}`,
          });
        await service.from("audit_events").insert({
          studio_id: membership.studio_id,
          entity_type: "booking",
          entity_id: booking.id,
          action: "booking.created_by_coach",
          reason: String(
            body.payload.reason ||
              "Coach created booking with administrative override",
          ),
          correlation_id: id,
          source: "booking_admin",
          before_state: null,
          after_state: booking,
        });
        await queueBookingEmails(
          service,
          booking.id,
          token,
          new URL(request.url).origin,
        );
        try {
          await ensureBookingPortalAccess(
            service,
            booking.id,
            new URL(request.url).origin,
          );
        } catch (inviteError) {
          await service.from("recommendations").upsert(
            {
              studio_id: membership.studio_id,
              student_id: student.id,
              entity_type: "booking",
              entity_id: booking.id,
              reason_code: "portal_invitation_failed",
              title: "Portal invitation needs retry",
              explanation:
                "The booking is confirmed, but portal access could not be linked.",
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
        return json({ resource: booking, manageUrl: `/booking/${token}` }, 201);
      } catch (error) {
        if (lessonId) await service.from("lessons").delete().eq("id", lessonId);
        if (bookingId)
          await service.from("bookings").delete().eq("id", bookingId);
        throw error;
      }
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
      return json({ resource: data }, 201);
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
        const { data: participants } = await service
          .from("lesson_participants")
          .select("lesson_id")
          .eq("booking_id", visible.id);
        const lessonIds = (participants ?? []).map((item) => item.lesson_id);
        if (lessonIds.length) {
          await Promise.all([
            service
              .from("lessons")
              .update({
                status: "cancelled",
                updated_at: new Date().toISOString(),
              })
              .in("id", lessonIds),
            service
              .from("lesson_participants")
              .update({ status: "cancelled" })
              .eq("booking_id", visible.id),
            service
              .from("calendar_projections")
              .update({ status: "queued", last_error: null })
              .in("lesson_id", lessonIds),
          ]);
        }
        if (visible.offering_id)
          await service.rpc("release_offering_seat", {
            target_offering: visible.offering_id,
          });
        const { data, error } = await service
          .from("bookings")
          .update({
            status: "cancelled",
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
          action: "booking.cancelled_by_coach",
          reason: "Coach cancelled booking",
          correlation_id: id,
          source: "booking_admin",
          before_state: visible,
          after_state: data,
        });
        return json({ resource: data });
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
        (body.payload.payment_policies.includes("deposit") &&
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
