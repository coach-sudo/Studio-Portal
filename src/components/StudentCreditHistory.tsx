import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { usePrivateIdentity } from "../hooks/usePrivateIdentity";
import { formatStudioDateTime } from "../domain/presentation";

const schema = z.object({
  studentId: z.string().uuid(),
  page: z.number().int(),
  total: z.number().int(),
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        quantity: z.number().int(),
        kind: z.string(),
        createdAt: z.string(),
        packageName: z.string(),
      }),
    )
    .max(25),
});
export function StudentCreditHistory({
  studentId,
  timezone,
}: {
  studentId: string;
  timezone: string;
}) {
  const identity = usePrivateIdentity();
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["credit-coverage", identity, studentId, "history", page],
    enabled: !!identity && open,
    queryFn: async ({ signal }) => {
      if (!supabase) throw new Error("Unavailable");
      const response = await (supabase as SupabaseClient)
        .rpc("student_credit_history", { p_student: studentId, p_page: page })
        .abortSignal(signal);
      if (response.error) throw new Error("History unavailable");
      const result = schema.parse(response.data);
      if (result.studentId !== studentId || result.page !== page)
        throw new Error("History context unavailable");
      return result;
    },
  });
  return (
    <details
      className="disclosure-section"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Credit history</summary>
      {query.isError ? (
        <p role="alert">
          Credit history unavailable.{" "}
          <button onClick={() => void query.refetch()}>Retry history</button>
        </p>
      ) : query.data ? (
        <>
          <div className="table-list">
            {query.data.items.map((item) => (
              <article key={item.id}>
                <div>
                  <strong>{item.packageName}</strong>
                  <small>
                    {item.kind} ·{" "}
                    {formatStudioDateTime(item.createdAt, timezone)}
                  </small>
                </div>
                <span>
                  {item.quantity > 0 ? "+" : ""}
                  {item.quantity}
                </span>
              </article>
            ))}
          </div>
          <div className="header-actions">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
              Previous history
            </button>
            <span>Page {page}</span>
            <button
              disabled={page * 25 >= query.data.total}
              onClick={() => setPage(page + 1)}
            >
              Next history
            </button>
          </div>
        </>
      ) : (
        <p role="status">Loading credit history…</p>
      )}
    </details>
  );
}
