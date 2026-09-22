import Stripe from "stripe";
import { json } from "../_shared/http";
import { derivePackageValues } from "../_shared/package-pricing";
import { serviceClient } from "../_shared/supabase";
import type { V2CommandContext } from "./types";

export async function handleFinanceCommands(
  ctx: V2CommandContext,
): Promise<Response | null> {
  const { audit, db, domain, input, request, requireCoach } = ctx;

  if (domain === "packages" && input.command === "assign") {
    const studioId = await requireCoach(),
      definitionId = String(input.payload.definitionId || ""),
      studentId = String(input.payload.studentId || ""),
      service = serviceClient();
    const [
      { data: definition, error: definitionError },
      { data: student, error: studentError },
    ] = await Promise.all([
      db
        .from("package_definitions")
        .select("*")
        .eq("id", definitionId)
        .eq("studio_id", studioId)
        .eq("active", true)
        .single(),
      db
        .from("students")
        .select("id")
        .eq("id", studentId)
        .eq("studio_id", studioId)
        .single(),
    ]);
    if (definitionError || studentError || !definition || !student)
      throw new Error(
        "VALIDATION_FAILED: Choose an active package and studio student.",
      );
    const expiresAt = definition.expiration_days
        ? new Date(
            Date.now() + Number(definition.expiration_days) * 86400000,
          ).toISOString()
        : null,
      { data: pkg, error: packageError } = await service
        .from("packages")
        .insert({
          student_id: student.id,
          definition_id: definition.id,
          name: definition.name,
          price_minor: definition.price_minor,
          currency: definition.currency,
          expires_at: expiresAt,
          stripe_price_id: definition.stripe_price_id,
          credit_quantity: definition.session_count,
          auto_apply: input.payload.autoApply === true,
        })
        .select()
        .single();
    if (packageError) throw packageError;
    const { error: creditError } = await service
      .from("package_credit_entries")
      .insert({
        package_id: pkg.id,
        kind: "adjustment",
        quantity: definition.session_count,
        reason: String(input.payload.reason || "Coach assigned package"),
        idempotency_key: `coach-package:${input.idempotencyKey}`,
      });
    if (creditError) {
      await service.from("packages").delete().eq("id", pkg.id);
      throw creditError;
    }
    let applied = 0;
    let autoApplyPending = false;
    if (pkg.auto_apply) {
      const { data: upcoming, error: upcomingError } = await service
        .from("lessons")
        .select("id")
        .eq("student_id", student.id)
        .eq("status", "scheduled")
        .is("package_id", null)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(50);
      if (upcomingError) autoApplyPending = true;
      else
        for (const lesson of upcoming || []) {
          const { data: packageId, error: applyError } = await service.rpc(
            "reserve_package_credit_for_lesson",
            { p_lesson_id: lesson.id, p_package_id: pkg.id },
          );
          if (applyError) {
            autoApplyPending = true;
            break;
          }
          if (packageId) applied += 1;
        }
    }
    return json({
      resource: { ...pkg, applied, autoApplyPending },
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "package",
        pkg.id,
        "package.assigned",
        null,
        pkg,
      ),
      queuedSideEffects: applied ? [`credits_applied:${applied}`] : [],
    });
  }

  if (
    domain === "packages" &&
    ["create", "update", "recalculate", "bulk_create"].includes(input.command)
  ) {
    const studioId = await requireCoach();
    const service = serviceClient();
    const createOne = async (
      payload: Record<string, any>,
      existingId?: string,
      existingVersion = 0,
    ) => {
      const { values } = await derivePackageValues(
        service,
        studioId,
        payload,
        payload.studentId ? String(payload.studentId) : undefined,
      );
      const renewalModes = [
        ...new Set(
          (Array.isArray(payload.renewalModes)
            ? payload.renewalModes
            : ["one_time"]
          )
            .filter((mode) =>
              [
                "one_time",
                "weekly",
                "biweekly",
                "monthly",
                "balance_threshold",
              ].includes(String(mode)),
            )
            .map(String),
        ),
      ];
      if (!renewalModes.length) renewalModes.push("one_time");
      let before: any = null;
      if (existingId) {
        const read = await service
          .from("package_definitions")
          .select("*")
          .eq("id", existingId)
          .eq("studio_id", studioId)
          .single();
        if (read.error || !read.data) throw new Error("FORBIDDEN");
        before = read.data;
        if (before.version !== existingVersion)
          throw new Error(`VERSION_CONFLICT:${existingVersion}`);
      }
      const requiresStripe =
        Boolean(values.direct_purchase) ||
        renewalModes.some((mode) => mode !== "one_time");
      const definitionId = existingId || crypto.randomUUID();
      const saveValues = {
        ...values,
        pricing_status: requiresStripe ? "syncing" : "current",
      } as Record<string, unknown>;
      const save = existingId
        ? service
            .from("package_definitions")
            .update({
              ...saveValues,
              version: existingVersion + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingId)
            .eq("version", existingVersion)
        : service
            .from("package_definitions")
            .insert({ id: definitionId, ...saveValues });
      const { data: definition, error: saveError } = await save
        .select()
        .maybeSingle();
      if (saveError) throw saveError;
      if (!definition) throw new Error(`VERSION_CONFLICT:${existingVersion}`);
      let oneTimePriceId: string | null = null;
      try {
        let productId: string | undefined;
        if (requiresStripe) {
          const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
          if (!stripeKey) throw new Error("Stripe is not configured.");
          const stripe = new Stripe(stripeKey, {
            apiVersion: "2026-07-29.dahlia",
          });
          if (before?.stripe_price_id) {
            try {
              const old = await stripe.prices.retrieve(before.stripe_price_id);
              productId =
                typeof old.product === "string" ? old.product : old.product?.id;
            } catch {
              /* create a replacement product */
            }
          }
          if (!productId) {
            const product = await stripe.products.create({
              name: String(values.name),
              description: String(values.description) || undefined,
              metadata: {
                studio_id: studioId,
                package_definition_id: definitionId,
                kind: "lesson_package",
              },
            });
            productId = product.id;
          } else
            await stripe.products.update(productId, {
              name: String(values.name),
              description: String(values.description) || undefined,
            });
          await service
            .from("package_billing_options")
            .update({ active: false, updated_at: new Date().toISOString() })
            .eq("definition_id", definitionId);
          for (const mode of renewalModes) {
            const recurring =
              mode === "weekly"
                ? { interval: "week" as const, interval_count: 1 }
                : mode === "biweekly"
                  ? { interval: "week" as const, interval_count: 2 }
                  : mode === "monthly"
                    ? { interval: "month" as const, interval_count: 1 }
                    : undefined;
            const price = await stripe.prices.create({
              product: productId,
              unit_amount: Number(values.price_minor),
              currency: String(values.currency).toLowerCase(),
              ...(recurring ? { recurring } : {}),
              metadata: {
                studio_id: studioId,
                package_definition_id: definitionId,
                billing_kind: "package_subscription",
                renewal_mode: mode,
                session_count: String(values.session_count),
              },
            });
            if (mode === "one_time") oneTimePriceId = price.id;
            await service.from("package_billing_options").upsert(
              {
                studio_id: studioId,
                definition_id: definitionId,
                renewal_mode: mode,
                balance_threshold:
                  mode === "balance_threshold"
                    ? Math.max(0, Number(payload.balanceThreshold ?? 1))
                    : null,
                stripe_price_id: price.id,
                active: true,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "definition_id,renewal_mode" },
            );
          }
        } else {
          await service.from("package_billing_options").upsert(
            {
              studio_id: studioId,
              definition_id: definitionId,
              renewal_mode: "one_time",
              stripe_price_id: null,
              active: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "definition_id,renewal_mode" },
          );
        }
        const { data: current, error: currentError } = await service
          .from("package_definitions")
          .update({
            stripe_price_id: oneTimePriceId,
            pricing_status: "current",
            updated_at: new Date().toISOString(),
          })
          .eq("id", definitionId)
          .select()
          .single();
        if (currentError) throw currentError;
        return { before, definition: current };
      } catch (error) {
        await service
          .from("package_definitions")
          .update({
            pricing_status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", definitionId);
        throw error;
      }
    };
    if (input.command === "bulk_create") {
      const payload = input.payload as Record<string, any>;
      const serviceIds = Array.isArray(payload.serviceIds)
        ? payload.serviceIds.map(String)
        : [];
      const sessionCounts = Array.isArray(payload.sessionCounts)
        ? payload.sessionCounts.map(Number)
        : [];
      const deliveryFormats = Array.isArray(payload.deliveryFormats)
        ? payload.deliveryFormats.map(String)
        : ["google_meet"];
      const combinations = serviceIds.flatMap((pricingServiceId) =>
        sessionCounts.flatMap((sessionCount) =>
          deliveryFormats.map((deliveryFormat) => ({
            ...payload,
            pricingServiceId,
            sessionCount,
            deliveryFormat,
          })),
        ),
      );
      if (!combinations.length || combinations.length > 36)
        throw new Error(
          "VALIDATION_FAILED: Create between 1 and 36 package combinations at a time.",
        );
      const created = [];
      for (const combination of combinations)
        created.push((await createOne(combination)).definition);
      return json({
        resource: created,
        recommendations: [],
        auditEventId: await audit(
          studioId,
          "package_definition",
          studioId,
          "package_definition.bulk_created",
          null,
          { count: created.length },
        ),
        queuedSideEffects: created.some((item) => item.stripe_price_id)
          ? ["stripe_prices_created"]
          : [],
      });
    }
    const payload = input.payload as Record<string, any>;
    const existingId =
      input.command === "create" ? undefined : String(input.entityId || "");
    const result = await createOne(payload, existingId, input.expectedVersion);
    return json({
      resource: result.definition,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "package_definition",
        result.definition.id,
        `package_definition.${input.command}`,
        result.before,
        result.definition,
      ),
      queuedSideEffects: result.definition.stripe_price_id
        ? ["stripe_price_created"]
        : [],
    });
  }

  if (
    domain === "packages" &&
    input.command === "toggle_auto_apply" &&
    input.entityId
  ) {
    const { data: before, error: readError } = await db
      .from("packages")
      .select("*,students!inner(studio_id)")
      .eq("id", input.entityId)
      .single();
    if (readError || !before) throw new Error("FORBIDDEN");
    const enabled = Boolean(input.payload.enabled);
    const service = serviceClient();
    const { data, error } = await service
      .from("packages")
      .update({
        auto_apply: enabled,
        version: input.expectedVersion + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", before.id)
      .eq("version", input.expectedVersion)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
    let applied = 0;
    if (enabled) {
      const { data: lessons } = await service
        .from("lessons")
        .select("id")
        .eq("student_id", before.student_id)
        .eq("status", "scheduled")
        .is("package_id", null)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at")
        .limit(50);
      for (const lesson of lessons || []) {
        const { data: packageId } = await service.rpc(
          "reserve_package_credit_for_lesson",
          { p_lesson_id: lesson.id, p_package_id: before.id },
        );
        if (packageId) applied += 1;
      }
    }
    return json({
      resource: { ...data, applied },
      recommendations: [],
      auditEventId: await audit(
        before.students.studio_id,
        "package",
        before.id,
        enabled ? "package.auto_apply_enabled" : "package.auto_apply_disabled",
        before,
        data,
      ),
      queuedSideEffects: applied ? [`credits_applied:${applied}`] : [],
    });
  }

  if (domain === "credits" && input.command === "grant") {
    const studioId = await requireCoach(),
      studentId = String(input.payload.studentId || ""),
      quantity = Number(input.payload.quantity || 0),
      reason = String(input.payload.reason || "Coach credit adjustment").trim();
    if (
      !studentId ||
      !Number.isInteger(quantity) ||
      quantity === 0 ||
      Math.abs(quantity) > 100 ||
      reason.length < 3
    )
      throw new Error(
        "VALIDATION_FAILED: Enter a student, a non-zero credit quantity, and a reason.",
      );
    const service = serviceClient(),
      { data: student, error: studentError } = await service
        .from("students")
        .select("id")
        .eq("id", studentId)
        .eq("studio_id", studioId)
        .single();
    if (studentError || !student) throw new Error("FORBIDDEN");
    let { data: pkg } = await service
      .from("packages")
      .select("id")
      .eq("student_id", studentId)
      .eq("name", "Studio lesson credits")
      .maybeSingle();
    if (!pkg) {
      const created = await service
        .from("packages")
        .insert({
          student_id: studentId,
          name: "Studio lesson credits",
          price_minor: 0,
          currency: "USD",
          credit_quantity: 1,
        })
        .select("id")
        .single();
      if (created.error) throw created.error;
      pkg = created.data;
    }
    const lessonId = String(input.payload.lessonId || "") || null;
    if (lessonId) {
      const linked = await service
        .from("lessons")
        .select("id")
        .eq("id", lessonId)
        .eq("studio_id", studioId)
        .eq("student_id", studentId)
        .single();
      if (linked.error)
        throw new Error(
          "VALIDATION_FAILED: The lesson does not belong to this student.",
        );
    }
    const { data, error } = await service
      .from("package_credit_entries")
      .insert({
        package_id: pkg.id,
        lesson_id: lessonId,
        kind: "adjustment",
        quantity,
        reason,
        idempotency_key: `coach-credit:${input.idempotencyKey}`,
      })
      .select()
      .single();
    if (error) throw error;
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "credit",
        data.id,
        "credit.granted",
        null,
        data,
      ),
      queuedSideEffects: [],
    });
  }

  if (
    domain === "credits" &&
    input.command === "use_for_lesson" &&
    input.entityId
  ) {
    const studioId = await requireCoach(),
      service = serviceClient();
    const { data: lesson, error: lessonError } = await service
      .from("lessons")
      .select("*")
      .eq("id", input.entityId)
      .eq("studio_id", studioId)
      .single();
    if (lessonError || !lesson || !lesson.student_id)
      throw new Error("FORBIDDEN");
    if (["cancelled", "late_cancelled"].includes(lesson.status))
      throw new Error(
        "INVALID_TRANSITION: A cancelled lesson cannot use a credit.",
      );
    const requestedPackage = String(input.payload.packageId || "");
    const { data: applied, error: applyError } = await service.rpc(
      "command_apply_lesson_credit",
      {
        target_lesson: lesson.id,
        requested_package: requestedPackage || null,
        entry_reason: String(
          input.payload.reason || `Credit used for ${lesson.topic}`,
        ),
        entry_idempotency_key: `lesson-credit:${lesson.id}`,
      },
    );
    if (applyError) throw applyError;
    const entry = applied.entry;
    return json({
      resource: entry,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "lesson",
        lesson.id,
        "lesson.paid_by_credit",
        lesson,
        { package_id: entry.package_id, credit_entry_id: entry.id },
      ),
      queuedSideEffects: [],
    });
  }

  if (
    domain === "discounts" &&
    ["create", "update", "archive"].includes(input.command)
  ) {
    const studioId = await requireCoach(),
      service = serviceClient(),
      payload = input.payload as Record<string, any>;
    let before: any = null;
    if (input.command !== "create") {
      const read = await service
        .from("discount_codes")
        .select("*")
        .eq("id", input.entityId)
        .eq("studio_id", studioId)
        .single();
      if (read.error || !read.data) throw new Error("FORBIDDEN");
      before = read.data;
      if (before.version !== input.expectedVersion)
        throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
    }
    if (input.command === "archive") {
      const updated = await service
        .from("discount_codes")
        .update({
          active: false,
          version: before.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", before.id)
        .eq("version", before.version)
        .select()
        .single();
      if (updated.error) throw updated.error;
      return json({
        resource: updated.data,
        recommendations: [],
        auditEventId: await audit(
          studioId,
          "discount_code",
          before.id,
          "discount_code.archived",
          before,
          updated.data,
        ),
        queuedSideEffects: [],
      });
    }
    const code = String(payload.code || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, "");
    const discountType = payload.discountType === "fixed" ? "fixed" : "percent",
      amount = Number(payload.amount || 0);
    if (
      code.length < 3 ||
      amount <= 0 ||
      (discountType === "percent" && amount > 100)
    )
      throw new Error(
        "VALIDATION_FAILED: Use a 3+ character code and a valid discount amount.",
      );
    const values = {
      studio_id: studioId,
      code,
      description: String(payload.description || ""),
      discount_type: discountType,
      amount,
      currency: String(payload.currency || "USD").toUpperCase(),
      service_ids: Array.isArray(payload.serviceIds) ? payload.serviceIds : [],
      active: payload.active !== false,
      starts_at: payload.startsAt || null,
      ends_at: payload.endsAt || null,
      max_redemptions: payload.maxRedemptions
        ? Number(payload.maxRedemptions)
        : null,
    };
    const result =
      input.command === "create"
        ? await service.from("discount_codes").insert(values).select().single()
        : await service
            .from("discount_codes")
            .update({
              ...values,
              version: before.version + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", before.id)
            .eq("version", before.version)
            .select()
            .single();
    if (result.error) throw result.error;
    return json({
      resource: result.data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "discount_code",
        result.data.id,
        `discount_code.${input.command}d`,
        before,
        result.data,
      ),
      queuedSideEffects: [],
    });
  }

  if (
    domain === "finance" &&
    input.command === "cancel_package_subscription" &&
    input.entityId
  ) {
    const service = serviceClient();
    const [{ data: authData }, { data: before, error: subscriptionError }] =
      await Promise.all([
        db.auth.getUser(),
        service
          .from("package_subscriptions")
          .select("*,students!inner(user_id,is_minor)")
          .eq("id", input.entityId)
          .single(),
      ]);
    if (!authData.user || subscriptionError || !before)
      throw new Error("FORBIDDEN");
    const student = Array.isArray(before.students)
      ? before.students[0]
      : before.students;
    const [{ data: coach }, { data: financeContact }] = await Promise.all([
      service
        .from("memberships")
        .select("id")
        .eq("studio_id", before.studio_id)
        .eq("user_id", authData.user.id)
        .eq("role", "coach")
        .maybeSingle(),
      service
        .from("student_relationships")
        .select("id")
        .eq("student_id", before.student_id)
        .eq("user_id", authData.user.id)
        .eq("can_view_finance", true)
        .maybeSingle(),
    ]);
    const isAdultStudent =
      student?.user_id === authData.user.id && !student?.is_minor;
    if (!coach && !financeContact && !isAdultStudent)
      throw new Error("FORBIDDEN");
    if (
      input.expectedVersion != null &&
      Number(input.expectedVersion) !== Number(before.version)
    )
      throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);

    let nextStatus = "cancelled";
    if (
      before.renewal_mode !== "balance_threshold" &&
      before.stripe_subscription_id
    ) {
      const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) throw new Error("Stripe is not configured.");
      const stripe = new Stripe(stripeKey, {
        apiVersion: "2026-07-29.dahlia",
      });
      await stripe.subscriptions.update(before.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
      nextStatus = "cancel_at_period_end";
    }

    const { data, error } = await service
      .from("package_subscriptions")
      .update({
        status: nextStatus,
        renewal_in_flight: false,
        renewal_attempt_key: null,
        renewal_claimed_at: null,
        next_billing_at:
          nextStatus === "cancel_at_period_end" ? before.next_billing_at : null,
        version: Number(before.version) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", before.id)
      .eq("version", before.version)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`VERSION_CONFLICT:${input.expectedVersion}`);
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        before.studio_id,
        "package_subscription",
        before.id,
        nextStatus === "cancel_at_period_end"
          ? "package_subscription.cancel_scheduled"
          : "package_subscription.cancelled",
        before,
        data,
      ),
      queuedSideEffects:
        nextStatus === "cancel_at_period_end"
          ? ["stripe_subscription_updated"]
          : [],
    });
  }

  if (domain === "finance" && input.command === "checkout_definition") {
    const definitionId = String(input.payload.packageDefinitionId || "");
    const requestedMode = String(input.payload.renewalMode || "one_time");
    const autoApply = Boolean(input.payload.autoApply);
    const [
      { data: student, error: studentError },
      { data: definition, error: definitionError },
      { data: billingOption, error: optionError },
    ] = await Promise.all([
      db
        .from("students")
        .select("id,studio_id,stripe_customer_id")
        .limit(1)
        .single(),
      db
        .from("package_definitions")
        .select("*")
        .eq("id", definitionId)
        .eq("active", true)
        .eq("visibility", "public")
        .eq("direct_purchase", true)
        .single(),
      db
        .from("package_billing_options")
        .select("*")
        .eq("definition_id", definitionId)
        .eq("renewal_mode", requestedMode)
        .eq("active", true)
        .maybeSingle(),
    ]);
    if (
      studentError ||
      definitionError ||
      !student ||
      !definition ||
      student.studio_id !== definition.studio_id ||
      optionError ||
      !billingOption?.stripe_price_id
    )
      throw new Error(
        "VALIDATION_FAILED: This package is not available for direct purchase.",
      );
    const service = serviceClient();
    const expiresAt = definition.expiration_days
      ? new Date(
          Date.now() + Number(definition.expiration_days) * 86400000,
        ).toISOString()
      : null;
    const { data: pkg, error: packageError } = await service
      .from("packages")
      .insert({
        student_id: student.id,
        definition_id: definition.id,
        name: definition.name,
        price_minor: definition.price_minor,
        currency: definition.currency,
        expires_at: expiresAt,
        stripe_price_id: definition.stripe_price_id,
        credit_quantity: definition.session_count,
        auto_apply: autoApply,
      })
      .select()
      .single();
    if (packageError) throw packageError;
    let packageSubscriptionId: string | undefined;
    try {
      const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
      if (!stripeKey) throw new Error("Stripe is not configured.");
      const stripe = new Stripe(stripeKey, {
        apiVersion: "2026-07-29.dahlia",
      });
      const origin = new URL(request.url).origin;
      const scheduled = ["weekly", "biweekly", "monthly"].includes(
        requestedMode,
      );
      if (requestedMode !== "one_time") {
        const { data: subscription, error: subscriptionError } = await service
          .from("package_subscriptions")
          .insert({
            studio_id: student.studio_id,
            student_id: student.id,
            definition_id: definition.id,
            billing_option_id: billingOption.id,
            package_id: pkg.id,
            stripe_customer_id: student.stripe_customer_id,
            renewal_mode: requestedMode,
            balance_threshold:
              requestedMode === "balance_threshold"
                ? Number(billingOption.balance_threshold ?? 1)
                : null,
            auto_apply: autoApply,
            status: "pending",
          })
          .select("id")
          .single();
        if (subscriptionError) throw subscriptionError;
        packageSubscriptionId = subscription.id;
      }
      const integrationIdentifier = `coachd_pkg_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (value) => String.fromCharCode(97 + (value % 26))).join("")}`;
      const checkout = await stripe.checkout.sessions.create(
        {
          mode: scheduled ? "subscription" : "payment",
          integration_identifier: integrationIdentifier,
          line_items: [{ price: billingOption.stripe_price_id, quantity: 1 }],
          client_reference_id: `${student.id}:${pkg.id}`,
          success_url: `${origin}/portal/payments?checkout=processing`,
          cancel_url: `${origin}/portal/payments?checkout=cancelled`,
          ...(student.stripe_customer_id
            ? { customer: student.stripe_customer_id }
            : {}),
          ...(!scheduled && requestedMode === "balance_threshold"
            ? {
                payment_intent_data: {
                  setup_future_usage: "off_session" as const,
                },
              }
            : {}),
          ...(scheduled
            ? {
                subscription_data: {
                  metadata: {
                    billing_kind: "package_subscription",
                    package_subscription_id: packageSubscriptionId!,
                    package_definition_id: definition.id,
                    package_id: pkg.id,
                    student_id: student.id,
                  },
                },
              }
            : {}),
          metadata: {
            student_id: student.id,
            package_id: pkg.id,
            package_definition_id: definition.id,
            package_subscription_id: packageSubscriptionId || "",
            billing_kind:
              requestedMode === "one_time"
                ? "package_purchase"
                : "package_subscription",
            renewal_mode: requestedMode,
            auto_apply: String(autoApply),
            idempotency_key: input.idempotencyKey,
          },
        },
        { idempotencyKey: input.idempotencyKey },
      );
      return json({
        resource: { id: checkout.id, url: checkout.url },
        recommendations: [],
        auditEventId: null,
        queuedSideEffects: ["stripe_webhook"],
      });
    } catch (error) {
      if (packageSubscriptionId)
        await service
          .from("package_subscriptions")
          .delete()
          .eq("id", packageSubscriptionId);
      await service.from("packages").delete().eq("id", pkg.id);
      throw error;
    }
  }

  if (
    domain === "finance" &&
    input.command === "adjust_account_credit" &&
    input.entityId
  ) {
    const studioId = await requireCoach();
    const amountMinor = Math.round(Number(input.payload.amountMinor || 0));
    const reason = String(input.payload.reason || "").trim();
    if (
      !Number.isSafeInteger(amountMinor) ||
      amountMinor === 0 ||
      reason.length < 3
    )
      throw new Error(
        "VALIDATION_FAILED: Enter a non-zero amount and a reason.",
      );
    const service = serviceClient();
    const { data: student, error: studentError } = await service
      .from("students")
      .select("id")
      .eq("id", input.entityId)
      .eq("studio_id", studioId)
      .single();
    if (studentError || !student) throw new Error("FORBIDDEN");
    const reference = `account-credit:${student.id}:${crypto.randomUUID()}`;
    const { data, error } = await service
      .from("payment_entries")
      .insert({
        student_id: student.id,
        kind: amountMinor > 0 ? "refund" : "adjustment",
        amount_minor: Math.abs(amountMinor),
        currency: String(input.payload.currency || "USD").toUpperCase(),
        external_reference: reference,
        reason,
      })
      .select()
      .single();
    if (error) throw error;
    return json({
      resource: data,
      recommendations: [],
      auditEventId: await audit(
        studioId,
        "student",
        student.id,
        "finance.account_credit_adjusted",
        null,
        { amountMinor, reason },
      ),
      queuedSideEffects: [],
    });
  }

  if (domain === "finance" && input.command === "checkout") {
    const packageId = String(input.payload.packageId || "");
    const { data: pkg, error: pkgError } = await db
      .from("packages")
      .select("id,student_id,name,stripe_price_id")
      .eq("id", packageId)
      .single();
    if (pkgError || !pkg?.stripe_price_id)
      throw new Error("VALIDATION_FAILED: Package price is not configured.");
    const stripeKey = Netlify.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("Stripe is not configured.");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-07-29.dahlia" });
    const origin = new URL(request.url).origin;
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: pkg.stripe_price_id, quantity: 1 }],
      client_reference_id: `${pkg.student_id}:${pkg.id}`,
      success_url: `${origin}/portal/payments?checkout=processing`,
      cancel_url: `${origin}/portal/payments?checkout=cancelled`,
      metadata: {
        student_id: pkg.student_id,
        package_id: pkg.id,
        idempotency_key: input.idempotencyKey,
      },
    });
    return json({
      resource: { id: checkout.id, url: checkout.url },
      recommendations: [],
      auditEventId: null,
      queuedSideEffects: ["stripe_webhook"],
    });
  }

  return null;
}
