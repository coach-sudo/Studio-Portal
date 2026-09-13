import type { Config, Context } from "@netlify/functions";
import { serviceClient } from "./_shared/supabase";

function page(
  title: string,
  message: string,
  token?: string,
  action?: "unsubscribe" | "subscribe",
) {
  const form =
    token && action
      ? `<form method="post" action="/unsubscribe/${token}"><input type="hidden" name="action" value="${action}"><button type="submit">${action === "unsubscribe" ? "Unsubscribe" : "Subscribe again"}</button></form>`
      : "";
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><main><h1>${title}</h1><p>${message}</p>${form}</main><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f3ea;color:#173f35;font:16px system-ui,sans-serif}main{box-sizing:border-box;width:min(440px,calc(100% - 32px));padding:32px;border-radius:18px;background:white;box-shadow:0 12px 36px #173f3520}h1{font-size:28px}p{line-height:1.6}button{margin-top:12px;padding:12px 20px;border:0;border-radius:9px;background:#173f35;color:white;font:inherit;cursor:pointer}</style></html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

export default async (request: Request, context: Context) => {
  if (request.method !== "GET" && request.method !== "POST")
    return new Response("Method not allowed", { status: 405 });
  const token = context.params.token;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      token,
    )
  )
    return page("Link unavailable", "This mailing-list link is not valid.");
  const db = serviceClient();
  const { data: contact, error } = await db
    .from("mailing_list_contacts")
    .select("id,unsubscribed_at")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (error || !contact)
    return page(
      "Link unavailable",
      "This mailing-list link is no longer available.",
    );
  if (request.method === "POST") {
    const form = await request.formData();
    const action = form.get("action");
    if (action !== "unsubscribe" && action !== "subscribe")
      return page("Link unavailable", "Choose a mailing-list preference.");
    const { error: updateError } = await db
      .from("mailing_list_contacts")
      .update({
        unsubscribed_at:
          action === "unsubscribe" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", contact.id);
    if (updateError)
      return page(
        "Please try again",
        "Your preference could not be saved right now.",
      );
    return action === "unsubscribe"
      ? page(
          "You’re unsubscribed",
          "You won’t receive future studio campaigns. Booking and account emails may still be sent.",
          token,
          "subscribe",
        )
      : page(
          "You’re subscribed",
          "You’ll receive future studio campaigns.",
          token,
          "unsubscribe",
        );
  }
  return contact.unsubscribed_at
    ? page(
        "Email preferences",
        "You’re unsubscribed from studio campaigns.",
        token,
        "subscribe",
      )
    : page(
        "Unsubscribe from campaigns",
        "Confirm below to stop receiving studio campaigns. Booking and account emails are separate.",
        token,
        "unsubscribe",
      );
};

export const config: Config = { path: "/unsubscribe/:token" };
