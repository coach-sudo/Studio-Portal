import type { SupabaseClient } from "@supabase/supabase-js";

export type PackageLedgerEntry = {
  id: string;
  package_id: string;
  kind: string;
  quantity: number;
  created_at: string;
};
/** Page explicitly: a truncated ledger must never be treated as a balance. */
export async function packageLedgers(db: SupabaseClient, packageIds: string[]) {
  const entries = new Map<string, PackageLedgerEntry[]>();
  const ids = [...new Set(packageIds)];
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    for (let offset = 0; ; offset += 1000) {
      const result = await db
        .from("package_credit_entries")
        .select("id,package_id,kind,quantity,created_at")
        .in("package_id", chunk)
        .order("id")
        .range(offset, offset + 999);
      if (result.error) throw result.error;
      for (const entry of (result.data || []) as PackageLedgerEntry[]) {
        const rows = entries.get(entry.package_id) || [];
        rows.push(entry);
        entries.set(entry.package_id, rows);
      }
      if ((result.data || []).length < 1000) break;
    }
  }
  for (const rows of entries.values())
    rows.sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
    );
  return entries;
}

export async function publishedLessonIds(
  db: SupabaseClient,
  lessonIds: string[],
) {
  const ids = new Set<string>();
  for (let start = 0; start < lessonIds.length; start += 100) {
    for (let offset = 0; ; offset += 1000) {
      const result = await db
        .from("notes")
        .select("id,lesson_id")
        .eq("status", "published")
        .in("lesson_id", lessonIds.slice(start, start + 100))
        .order("id")
        .range(offset, offset + 999);
      if (result.error) throw result.error;
      for (const note of result.data || []) ids.add(note.lesson_id);
      if ((result.data || []).length < 1000) break;
    }
  }
  return ids;
}
