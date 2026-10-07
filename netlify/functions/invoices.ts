import type { Config } from "@netlify/functions";
import { userClient } from "./_shared/supabase";
import { apiError, json } from "./_shared/http";
export default async (request: Request) => {
  try {
    if (request.method !== "GET")
      return json({ message: "Method not allowed" }, 405);
    const db = userClient(request),
      auth = await db.auth.getUser();
    if (!auth.data.user)
      return json({ message: "Sign in to view invoices." }, 401);
    const invoices = [];
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
    return json({ invoices });
  } catch (error) {
    return apiError(error, crypto.randomUUID());
  }
};
export const config: Config = { path: "/api/invoices" };
