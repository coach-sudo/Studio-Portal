import type { Config } from "@netlify/functions";
import { serviceClient, userClient } from "./_shared/supabase";
import type { Invoice } from "../../src/domain/invoices";
import { apiError, json } from "./_shared/http";
export default async (request: Request) => {
  try {
    if (request.method !== "GET")
      return json({ message: "Method not allowed" }, 405);
    const db = userClient(request),
      auth = await db.auth.getUser();
    if (!auth.data.user)
      return json({ message: "Sign in to view invoices." }, 401);
    const invoices: Invoice[] = [];
    for (let page = 0; ; page++) {
      const result = await db
        .from("studio_invoices")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id")
        .range(page * 500, page * 500 + 499);
      if (result.error) throw result.error;
      invoices.push(...result.data);
      if (result.data.length < 500) break;
    }
    const delivery = new Map<string, Invoice["delivery"]>();
    // Invoice visibility was established with the caller's RLS-scoped client above.
    // Read only mail attached to those visible invoice IDs; do not expose outbox contents.
    if (invoices.length) {
      const service = serviceClient();
      for (let batch = 0; batch < invoices.length; batch += 100) {
        const ids = invoices
          .slice(batch, batch + 100)
          .map((invoice) => invoice.id);
        for (let page = 0; ; page++) {
          const messages = await service
            .from("outbox_messages")
            .select(
              "status,last_error,suppression_reason,updated_at,entity_snapshot",
            )
            .eq("event_key", "invoice.issued")
            .in("entity_snapshot->>invoiceId", ids)
            .order("created_at", { ascending: false })
            .order("id")
            .range(page * 500, page * 500 + 499);
          if (messages.error) {
            for (const id of ids)
              if (!delivery.has(id)) delivery.set(id, { status: "unknown" });
            break;
          }
          for (const message of messages.data ?? []) {
            const id = message.entity_snapshot?.invoiceId;
            if (typeof id !== "string" || !ids.includes(id) || delivery.has(id))
              continue;
            delivery.set(id, {
              status:
                message.status === "draft"
                  ? "not_sent"
                  : message.status === "approved"
                    ? "queued"
                    : [
                          "queued",
                          "sending",
                          "sent",
                          "failed",
                          "suppressed",
                          "cancelled",
                        ].includes(message.status)
                      ? message.status
                      : "unknown",
              error:
                message.last_error || message.suppression_reason || undefined,
              updatedAt: message.updated_at,
            });
          }
          if ((messages.data?.length ?? 0) < 500) break;
        }
      }
    }
    return json({
      invoices: invoices.map((invoice) => ({
        ...invoice,
        delivery: delivery.get(invoice.id) ?? { status: "not_sent" },
      })),
    });
  } catch (error) {
    return apiError(error, crypto.randomUUID());
  }
};
export const config: Config = { path: "/api/invoices" };
