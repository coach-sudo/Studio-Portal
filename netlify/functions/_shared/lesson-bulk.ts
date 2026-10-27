import type { serviceClient } from "./supabase";

// Each item RPC is its own transaction; a transport failure leaves a lease that
// can be reclaimed. Never infer a mutation failed merely because its reply died.
export async function processLessonBulkItems(
  db: ReturnType<typeof serviceClient>,
  jobId?: string,
  limit = 10,
  checkpoint: () => void = () => {},
) {
  checkpoint();
  const claimed = await db.rpc("claim_lesson_bulk_items", {
    p_limit: limit,
    p_job: jobId,
  });
  if (claimed.error) throw claimed.error;
  const items = claimed.data as unknown as {
    id: string;
    claim_token: string;
  }[];
  const outcomes: { itemId: string; status: string }[] = [];
  for (const item of items) {
    checkpoint();
    try {
      const result = await db.rpc("process_lesson_bulk_item", {
        p_item: item.id,
        p_token: item.claim_token,
      });
      if (result.error) throw result.error;
      outcomes.push({
        itemId: item.id,
        status: (result.data as { status: string }).status,
      });
    } catch {
      outcomes.push({ itemId: item.id, status: "transport_pending" });
    }
  }
  return outcomes;
}
