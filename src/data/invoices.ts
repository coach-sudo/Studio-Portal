import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { readApiClientError } from "./apiClientError";
import type { Invoice } from "../domain/invoices";
export function useInvoices(isDemo: boolean, demoInvoices: Invoice[] = []) {
  const query = useQuery({
    queryKey: ["invoices", isDemo ? "demo" : "live"],
    enabled: !isDemo,
    queryFn: async () => {
      const auth = await supabase?.auth.getSession();
      if (!auth?.data.session) throw new Error("Sign in to view invoices.");
      const response = await fetch("/api/invoices", {
        headers: { Authorization: `Bearer ${auth.data.session.access_token}` },
      });
      if (!response.ok)
        throw await readApiClientError(
          response,
          "Invoices could not be loaded.",
        );
      return (await response.json()).invoices as Invoice[];
    },
  });
  return isDemo
    ? { ...query, data: demoInvoices, isLoading: false, error: null }
    : query;
}
