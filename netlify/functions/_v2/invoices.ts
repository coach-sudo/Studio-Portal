import Stripe from "stripe";
import { z } from "zod";
import { json } from "../_shared/http";
import { serviceClient } from "../_shared/supabase";
import { portalOrigin } from "../_shared/portal-url";
import { notificationRecipientContext } from "../_shared/notification-recipients";
import { invoiceBilling } from "../../../src/domain/invoiceBilling";
import { dispatchOutbox } from "../_shared/outbox-dispatch";
import {
  invoiceDue,
  invoiceLineTotal,
  type Invoice,
} from "../../../src/domain/invoices";
import type { V2CommandContext } from "./types";

async function queueInvoiceEmail(
  service: ReturnType<typeof serviceClient>,
  invoice: Invoice,
  recipients: string[],
  key: string,
  correlationId: string,
) {
  const ids: string[] = [];
  for (const recipient of recipients) {
    const result = await service
      .from("outbox_messages")
      .upsert(
        {
          studio_id: invoice.studio_id,
          student_id: invoice.student_id,
          channel: "email",
          recipient,
          subject: `${invoice.branding.studioName} · Invoice ${invoice.number}`,
          body: `Hello ${invoice.recipient.name},\n\n${invoice.introduction}\n\nInvoice ${invoice.number}\nBalance due: ${new Intl.NumberFormat("en-US", { style: "currency", currency: invoice.currency }).format(invoiceDue(invoice) / 100)}\nDue: ${invoice.due_date}\n\nView or download your invoice: ${portalOrigin()}/portal/payments?invoice=${invoice.id}\n\n${invoice.footer}`,
          status: "queued",
          send_at: new Date().toISOString(),
          event_key: "invoice.issued",
          dedupe_key: `${key}:${recipient}`,
          recipient_intent: "payment_due",
          entity_snapshot: {
            invoiceId: invoice.id,
            invoiceVersion: invoice.version,
            approvedAt: new Date().toISOString(),
          },
          correlation_id: correlationId,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      )
      .select("id");
    if (result.error) throw result.error;
    ids.push(
      ...(result.data ?? []).map((message: { id: string }) => message.id),
    );
  }
  return ids;
}

function startInvoiceDelivery(ctx: V2CommandContext, ids: string[]) {
  if (ids.length && ctx.context?.waitUntil)
    ctx.context.waitUntil(
      dispatchOutbox({ ids }).catch(() => {
        console.error(
          JSON.stringify({
            event: "invoice.dispatch_failed",
            correlationId: ctx.id,
          }),
        );
      }),
    );
}

const lineSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["service", "package"]),
    referenceId: z.string().uuid(),
    description: z.string().trim().min(1).max(500),
    quantity: z.number().int().min(1).max(500),
    unitMinor: z.number().int().min(0).max(100000000),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    lessonIds: z.array(z.string().uuid()).max(1),
  })
  .refine((l) => l.endsOn >= l.startsOn, "Coverage end must follow its start.");
const saveSchema = z
  .object({
    student_id: z.string().uuid(),
    status: z.enum(["draft", "open"]),
    issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    introduction: z.string().max(3000),
    notes: z.string().max(5000),
    footer: z.string().max(2000),
    items: z.array(lineSchema).min(1).max(50),
  })
  .refine(
    (v) => v.due_date >= v.issue_date,
    "Due date must follow the issue date.",
  );

export async function handleInvoiceCommands(
  ctx: V2CommandContext,
): Promise<Response | null> {
  if (ctx.domain !== "invoices") return null;
  const { input, db, requireCoach, audit } = ctx,
    service = serviceClient();
  if (input.command === "save") {
    const studioId = await requireCoach(),
      value = saveSchema.parse(input.payload);
    const [student, studio] = await Promise.all([
      db
        .from("students")
        .select("id,full_name,email")
        .eq("id", value.student_id)
        .eq("studio_id", studioId)
        .single(),
      db.from("studios").select("name,settings").eq("id", studioId).single(),
    ]);
    if (student.error || studio.error || !student.data || !studio.data)
      throw new Error("FORBIDDEN");
    const billingContext = await notificationRecipientContext(
      service,
      value.student_id,
    );
    const billing = invoiceBilling(
      billingContext.student,
      billingContext.contacts,
    );
    if (value.status === "open" && billing.issueError)
      throw new Error(
        `VALIDATION_FAILED: ${billing.issueError} Save a draft or update the household payer settings.`,
      );
    const settings = studio.data.settings ?? {};
    const items = [];
    for (const line of value.items) {
      const source = await db
        .from(
          line.kind === "package" ? "package_definitions" : "booking_services",
        )
        .select("*")
        .eq("id", line.referenceId)
        .eq("studio_id", studioId)
        .single();
      if (source.error || !source.data) throw new Error("FORBIDDEN");
      if (source.data.currency !== String(settings.currency ?? "USD"))
        throw new Error(
          "VALIDATION_FAILED: Invoice lines must use the studio currency.",
        );
      invoiceLineTotal(line);
      if (line.kind === "package" && line.unitMinor === 0)
        throw new Error(
          "VALIDATION_FAILED: Package invoices need a positive price. Use Set remaining credits for complimentary credits.",
        );
      items.push({
        ...line,
        creditMinor: 0,
        paidMinor: 0,
        creditQuantity:
          line.kind === "package"
            ? source.data.session_count * line.quantity
            : 0,
        expirationDays: source.data.expiration_days ?? null,
      });
    }
    const result = await service.rpc("save_studio_invoice", {
      p_value: {
        ...value,
        id: input.entityId,
        items,
        studio_id: studioId,
        currency: String(settings.currency ?? "USD"),
        branding: {
          studioName: settings.studioName ?? studio.data.name,
          email: settings.contactEmail,
          logoStoragePath: settings.branding?.logoStoragePath,
          logoUrl: settings.branding?.logoStoragePath
            ? undefined
            : settings.branding?.logoUrl,
        },
        recipient: billing.recipient,
      },
      p_key: `invoice:${input.idempotencyKey}`,
      p_version: input.expectedVersion,
    });
    if (result.error) throw result.error;
    const saved = result.data as Invoice;
    if (saved.status === "draft")
      return json({ resource: saved, delivery: { status: "draft" } });
    try {
      if (
        saved.status === "void" ||
        !saved.recipient.email ||
        !billing.recipients.includes(saved.recipient.email)
      )
        throw new Error("Invoice payer changed");
      await audit(
        studioId,
        "invoice",
        saved.id,
        "invoice.send_approved",
        saved,
        { recipients: [saved.recipient.email], automatic: true },
      );
      const ids = await queueInvoiceEmail(
        service,
        saved,
        [saved.recipient.email],
        `invoice-issued:${saved.id}`,
        ctx.id,
      );
      startInvoiceDelivery(ctx, ids);
      return json({
        resource: saved,
        delivery: { status: "queued", recipients: [saved.recipient.email] },
      });
    } catch {
      // Saving succeeded. A delivery failure must not make the coach create a duplicate invoice.
      return json({
        resource: saved,
        delivery: {
          status: "failed",
          message:
            "Invoice saved, but its email could not be queued. Review the payer settings and use Review and send to retry.",
        },
      });
    }
  }
  if (!input.entityId) throw new Error("VALIDATION_FAILED");
  const visible = await db
    .from("studio_invoices")
    .select("*")
    .eq("id", input.entityId)
    .single();
  if (visible.error || !visible.data) throw new Error("FORBIDDEN");
  const invoice = visible.data as Invoice;
  if (
    ["checkout", "check_checkout", "cancel_checkout"].includes(input.command)
  ) {
    const key = Netlify.env.get("STRIPE_SECRET_KEY");
    if (!key) throw new Error("Stripe is not configured.");
    const stripe = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
    let claimed = invoice;
    if (input.command === "checkout") {
      const claim = await service.rpc("claim_studio_invoice_checkout", {
        p_invoice: invoice.id,
        p_amount: z.number().int().positive().parse(input.payload.amountMinor),
        p_key: `${input.payload.returnTo === "coach" ? "coach" : "student"}:${input.idempotencyKey}`,
        p_version: input.expectedVersion,
      });
      if (claim.error) throw claim.error;
      claimed = claim.data as Invoice;
    }
    if (!claimed.checkout_key) return json({ resource: claimed });
    // Reusing the stored claim recovers safely after a provider/network interruption.
    let session = claimed.checkout_session_id
      ? await stripe.checkout.sessions.retrieve(claimed.checkout_session_id)
      : await stripe.checkout.sessions.create(
          {
            mode: "payment",
            line_items: [
              {
                price_data: {
                  currency: claimed.currency.toLowerCase(),
                  unit_amount: claimed.checkout_amount!,
                  product_data: { name: `Invoice ${claimed.number}` },
                },
                quantity: 1,
              },
            ],
            success_url: `${portalOrigin()}${claimed.checkout_key.startsWith("coach:") ? "/coach/finance" : "/portal/payments"}?invoice=${claimed.id}&checkout=processing`,
            cancel_url: `${portalOrigin()}${claimed.checkout_key.startsWith("coach:") ? "/coach/finance" : "/portal/payments"}?invoice=${claimed.id}`,
            metadata: {
              studio_invoice_id: claimed.id,
              invoice_checkout_key: claimed.checkout_key,
            },
          },
          { idempotencyKey: claimed.checkout_key },
        );
    const attached = await service.rpc("attach_studio_invoice_checkout", {
      p_invoice: claimed.id,
      p_key: claimed.checkout_key,
      p_session: session.id,
    });
    if (attached.error) throw attached.error;
    if (input.command === "cancel_checkout" && session.status === "open")
      session = await stripe.checkout.sessions.expire(session.id);
    if (session.payment_status === "paid") {
      if (session.currency !== claimed.currency.toLowerCase())
        throw new Error("VALIDATION_FAILED: Invoice currency mismatch.");
      const settled = await service.rpc("settle_studio_invoice_checkout", {
        p_invoice: claimed.id,
        p_key: claimed.checkout_key,
        p_session: session.id,
        p_amount: session.amount_total,
      });
      if (settled.error) throw settled.error;
      return json({ resource: settled.data });
    }
    if (session.status === "expired") {
      const released = await service.rpc("release_studio_invoice_checkout", {
        p_invoice: claimed.id,
        p_key: claimed.checkout_key,
      });
      if (released.error) throw released.error;
      return json({ resource: { status: "expired" } });
    }
    return json({
      resource: {
        url: session.status === "open" ? session.url : null,
        status: "pending",
      },
    });
  }
  const studioId = ["apply_account_credit", "apply_lesson_credit"].includes(
    input.command,
  )
    ? invoice.studio_id
    : await requireCoach();
  if (invoice.studio_id !== studioId) throw new Error("FORBIDDEN");
  if (
    input.command === "record_payment" ||
    input.command === "apply_account_credit"
  ) {
    const method =
      input.command === "apply_account_credit"
        ? "account_credit"
        : z.enum(["cash", "bank"]).parse(input.payload.method);
    const result = await service.rpc("settle_studio_invoice", {
      p_invoice: invoice.id,
      p_amount: z.number().int().positive().parse(input.payload.amountMinor),
      p_method: method,
      p_reference: `invoice-payment:${input.idempotencyKey}`,
      p_version: input.expectedVersion,
    });
    if (result.error) throw result.error;
    await audit(
      studioId,
      "invoice",
      invoice.id,
      "invoice.payment_recorded",
      invoice,
      result.data,
    );
    return json({ resource: result.data });
  }
  if (input.command === "apply_lesson_credit") {
    const result = await service.rpc("apply_invoice_lesson_credit", {
      p_invoice: invoice.id,
      p_line: z.string().uuid().parse(input.payload.lineId),
      p_version: input.expectedVersion,
    });
    if (result.error) throw result.error;
    await audit(
      studioId,
      "invoice",
      invoice.id,
      "invoice.lesson_credit_applied",
      invoice,
      result.data,
    );
    return json({ resource: result.data });
  }
  if (input.command === "void") {
    if (invoice.paid_minor || invoice.credit_minor)
      throw new Error(
        "INVALID_TRANSITION: Settle or reverse payments before voiding a paid invoice.",
      );
    const result = await service.rpc("void_studio_invoice", {
      p_invoice: invoice.id,
      p_version: input.expectedVersion,
    });
    if (result.error) throw result.error;
    await audit(
      studioId,
      "invoice",
      invoice.id,
      "invoice.voided",
      invoice,
      result.data,
    );
    return json({ resource: result.data });
  }
  if (input.command === "preview_recipients" || input.command === "send") {
    if (invoice.status === "draft" || invoice.status === "void")
      throw new Error("INVALID_TRANSITION");
    const context = await notificationRecipientContext(
      service,
      invoice.student_id,
    );
    const billing = invoiceBilling(context.student, context.contacts);
    const recipients = billing.recipients;
    if (input.command === "preview_recipients")
      return json({
        resource: {
          recipients,
          payer: billing.recipient,
          issueError: billing.issueError,
        },
      });
    const approved = z
      .array(z.string().email())
      .parse(input.payload.recipients)
      .sort();
    if (
      invoice.version !== input.expectedVersion ||
      JSON.stringify(approved) !== JSON.stringify([...recipients].sort())
    )
      throw new Error(
        "VERSION_CONFLICT: Review the invoice and recipients again.",
      );
    if (!recipients.length)
      throw new Error(
        `VALIDATION_FAILED: ${billing.issueError || "No permitted invoice recipient."}`,
      );
    let addressed = invoice;
    if (
      JSON.stringify(invoice.recipient) !== JSON.stringify(billing.recipient)
    ) {
      const corrected = await service
        .from("studio_invoices")
        .update({
          recipient: billing.recipient,
          version: invoice.version + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", invoice.id)
        .eq("version", invoice.version)
        .select("*")
        .maybeSingle();
      if (corrected.error) throw corrected.error;
      if (!corrected.data)
        throw new Error("VERSION_CONFLICT: Review the invoice again.");
      addressed = corrected.data as Invoice;
    }
    const ids = await queueInvoiceEmail(
      service,
      addressed,
      recipients,
      `invoice-send:${input.idempotencyKey}`,
      ctx.id,
    );
    await audit(
      studioId,
      "invoice",
      invoice.id,
      "invoice.send_approved",
      invoice,
      { recipients, recipient: addressed.recipient },
    );
    startInvoiceDelivery(ctx, ids);
    return json({ resource: { recipients, status: "approved" } });
  }
  throw new Error("UNKNOWN_COMMAND");
}
