import type { StudioSnapshot } from "../domain/model";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { recordKinds, type RecordKind } from "../app/recordLinks";

export const targetSchema = z.object({
  kind: z.enum(recordKinds),
  id: z.string().uuid(),
  studentId: z.string().uuid().nullish(),
  lessonId: z.string().uuid().nullish(),
  assignmentId: z.string().uuid().nullish(),
});
export const searchSchema = z.object({
  items: z
    .array(
      targetSchema.extend({
        title: z.string().max(240),
        snippet: z.string().max(240),
      }),
    )
    .max(30),
  moreGroups: z.array(z.enum(recordKinds)).max(5),
  page: z.number().int().positive(),
});
export type SearchPage = z.infer<typeof searchSchema>;
async function rpc(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  if (!supabase) throw new Error("Search is unavailable.");
  const q = (supabase as SupabaseClient).rpc(name, args);
  const r = await (signal ? q.abortSignal(signal) : q);
  if (r.error) throw new Error("This information is unavailable. Try again.");
  return r.data;
}
export async function searchRecords(
  query: string,
  studentId?: string,
  group?: string,
  page = 1,
  signal?: AbortSignal,
) {
  if (query.trim().length < 2) return { items: [], moreGroups: [], page: 1 };
  return searchSchema.parse(
    await rpc(
      "studio_global_search",
      {
        p_query: query.trim().slice(0, 120),
        p_student: studentId || null,
        p_group: group || null,
        p_page: page,
      },
      signal,
    ),
  );
}
export async function loadRecordTarget(
  kind: string,
  id: string,
  studentId?: string,
  signal?: AbortSignal,
) {
  z.enum(recordKinds).parse(kind);
  z.string().uuid().parse(id);
  if (studentId) z.string().uuid().parse(studentId);
  const target = targetSchema.nullable().parse(
    await rpc(
      "studio_record_target",
      {
        p_kind: kind,
        p_id: id,
        p_student: studentId || null,
      },
      signal,
    ),
  );
  if (
    target &&
    (target.id !== id ||
      target.kind !== kind ||
      (studentId && target.studentId !== studentId))
  )
    throw new Error("Record unavailable.");
  return target;
}
export function useSearchIdentity() {
  const [identity, setIdentity] = useState<string | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let alive = true,
      events = 0;
    void supabase.auth.getSession().then(({ data }) => {
      if (alive && events === 0) setIdentity(data.session?.user.id || null);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => {
      events++;
      setIdentity(s?.user.id || null);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return identity;
}
export function useGlobalSearch(
  query: string,
  studentId?: string,
  group?: string,
  page = 1,
  enabled = true,
) {
  const identity = useSearchIdentity();
  return useQuery({
    queryKey: [
      "workspace-search",
      identity,
      studentId || null,
      query,
      group || null,
      page,
    ],
    queryFn: ({ signal }) =>
      searchRecords(query, studentId, group, page, signal),
    enabled: enabled && !!identity && query.trim().length >= 2,
    staleTime: 0,
    gcTime: 60_000,
    retry: false,
  });
}

export function demoSearch(
  data: StudioSnapshot,
  query: string,
  group?: string,
  page = 1,
): SearchPage {
  const q = query.trim().toLowerCase(),
    coach = data.role === "coach";
  if (q.length < 2) return { items: [], moreGroups: [], page: 1 };
  const rows: SearchPage["items"] = [
    ...(coach
      ? data.students.map((s) => ({
          kind: "student" as const,
          id: s.id,
          studentId: s.id,
          title: s.fullName,
          snippet: "",
        }))
      : []),
    ...data.lessons.map((l) => ({
      kind: "lesson" as const,
      id: l.id,
      studentId: l.studentId,
      title: l.topic,
      snippet: "",
    })),
    ...data.bookings.map((b) => ({
      kind: "booking" as const,
      id: b.id,
      studentId: b.studentId,
      title: `Booking ${b.reference}`,
      snippet: "",
    })),
    ...data.materials.map((m) => ({
      kind: "resource" as const,
      id: m.resourceId || m.id,
      studentId: m.studentId,
      title: m.title,
      snippet: "",
    })),
    ...data.notes
      .filter((n) => coach || n.status === "published")
      .map((n) => ({
        kind: "note" as const,
        id: n.id,
        studentId: n.studentId,
        lessonId: n.lessonId,
        title: n.title,
        snippet: n.body.replace(/<[^>]*>/g, " ").slice(0, 240),
      })),
  ]
    .filter(
      (r) =>
        (!group || r.kind === group) &&
        `${r.title} ${r.snippet}`.toLowerCase().includes(q),
    )
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  const moreGroups: RecordKind[] = [],
    items: SearchPage["items"] = [],
    size = group ? 20 : 5;
  for (const kind of recordKinds) {
    const matched = rows.filter((r) => r.kind === kind),
      offset = (page - 1) * size;
    items.push(...matched.slice(offset, offset + size));
    if (matched.length > offset + size) moreGroups.push(kind);
  }
  return { items, moreGroups, page };
}
