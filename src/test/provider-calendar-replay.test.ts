import { beforeEach, expect, it, vi } from "vitest";
import { importCalendar } from "../../netlify/functions/_shared/provider-intake";

const f = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, any>[]>,
  events: [] as Record<string, any>[],
  writes: [] as string[],
  calls: [] as { name: string; args: any }[],
  sequence: 0,
  readError: false,
}));
vi.mock("../../netlify/functions/_shared/booking-email", () => ({
  queueLessonChangeEmails: vi.fn(async () => undefined),
}));
vi.mock("../../netlify/functions/_shared/supabase", () => ({
  serviceClient: () => ({
    from: (table: string) => {
      const filters: ((r: any) => boolean)[] = [];
      let operation = "select",
        values: any,
        conflicts: string[] = ["id"],
        result: any;
      const execute = () => {
        if (result) return result;
        const rows = (f.tables[table] ||= []);
        const selected = rows.filter((r) => filters.every((test) => test(r)));
        if (operation === "select")
          return (result = {
            data: selected,
            error:
              f.readError && table === "integration_imports"
                ? new Error("Read failed")
                : null,
          });
        f.writes.push(table);
        if (operation === "delete")
          f.tables[table] = rows.filter((r) => !selected.includes(r));
        else if (operation === "update")
          selected.forEach((r) => Object.assign(r, values));
        else
          for (const value of Array.isArray(values) ? values : [values]) {
            const existing =
              operation === "upsert" &&
              rows.find((r) => conflicts.every((k) => r[k] === value[k]));
            if (existing) Object.assign(existing, value);
            else
              rows.push({
                id: "generated-" + ++f.sequence,
                version: 1,
                ...structuredClone(value),
              });
          }
        return (result = {
          data: rows.filter((r) => filters.every((test) => test(r))),
          error: null,
        });
      };
      const q: any = {
        select: () => q,
        eq: (k: string, v: any) => {
          filters.push((r) => r[k] === v);
          return q;
        },
        in: (k: string, v: any[]) => {
          filters.push((r) => v.includes(r[k]));
          return q;
        },
        not: (k: string, _op: string, v: string) => {
          filters.push((r) => !v.includes(r[k]));
          return q;
        },
        limit: () => q,
        maybeSingle: async () => {
          const r = execute();
          return { ...r, data: r.data[0] || null };
        },
        single: async () => {
          const r = execute();
          return { ...r, data: r.data.at(-1) || null };
        },
        upsert: (v: any, options?: { onConflict?: string }) => {
          operation = "upsert";
          values = v;
          conflicts = options?.onConflict?.split(",") || ["lesson_id"];
          return q;
        },
        insert: (v: any) => {
          operation = "insert";
          values = v;
          return q;
        },
        update: (v: any) => {
          operation = "update";
          values = v;
          return q;
        },
        delete: () => {
          operation = "delete";
          return q;
        },
        then: (resolve: (r: any) => void) => resolve(execute()),
      };
      return q;
    },
    rpc: async (name: string, args: any) => {
      f.calls.push({ name, args });
      if (name === "reserve_student_upcoming_credits") {
        for (const l of f.tables.lessons.filter(
          (l) => l.student_id === args.p_student && l.status === "scheduled",
        ))
          if (
            !f.tables.package_credit_entries.some((e) => e.lesson_id === l.id)
          )
            f.tables.package_credit_entries.push({
              lesson_id: l.id,
              amount: -1,
            });
      } else if (name === "command_change_lesson_state") {
        const l = f.tables.lessons.find((l) => l.id === args.p_lesson_id)!;
        expect(args.p_expected_version).toBe(l.version);
        Object.assign(
          l,
          args.p_action === "cancel"
            ? { status: "cancelled" }
            : { starts_at: args.p_starts_at, ends_at: args.p_ends_at },
        );
        l.version++;
      } else throw new Error("Unexpected RPC " + name);
      return { data: {}, error: null };
    },
  }),
}));
const studio = { id: "studio", timezone: "America/New_York", settings: {} };
const student = {
  id: "student",
  full_name: "Jules River",
  email: "jules@example.test",
};
const event = () => ({
  id: "calendar-signal",
  summary: "Lessonface lesson Jules River",
  attendees: [{ email: student.email }],
  start: { dateTime: "2031-11-02T18:00:00Z" },
  end: { dateTime: "2031-11-02T19:00:00Z" },
  etag: "version-1",
});
const counts = () =>
  [
    "lessons",
    "lesson_participants",
    "calendar_projections",
    "package_credit_entries",
  ].map((t) => f.tables[t].length);
beforeEach(() => {
  f.sequence = 0;
  f.readError = false;
  f.writes = [];
  f.calls = [];
  f.events = [event()];
  f.tables = {
    lessons: [
      {
        id: "approved-lesson",
        studio_id: studio.id,
        student_id: student.id,
        starts_at: event().start.dateTime,
        ends_at: event().end.dateTime,
        status: "scheduled",
        version: 4,
        source_provider: "gmail",
        source_external_id: "original-email",
      },
    ],
    integration_imports: [
      {
        id: "approved-import",
        studio_id: studio.id,
        provider: "google_calendar",
        external_id: "calendar-signal",
        lesson_id: "approved-lesson",
        student_id: student.id,
        status: "imported",
        payload: event(),
      },
    ],
    calendar_projections: [
      {
        lesson_id: "approved-lesson",
        external_event_id: "original-projection",
        projected_version: 4,
      },
    ],
    lesson_participants: [
      { lesson_id: "approved-lesson", student_id: student.id },
    ],
    package_credit_entries: [{ lesson_id: "approved-lesson", amount: -1 }],
  };
  vi.stubGlobal("Netlify", { env: { get: () => undefined } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      expect(url).toMatch(
        /^https:\/\/www.googleapis.com\/calendar\/v3\/calendars\/primary\/events\?/,
      );
      return Response.json({ items: f.events });
    }),
  );
});

it.each(["gmail", "studio"])(
  "preserves approved %s lesson, participants, projection and single reservation across repeated and overlapping scans",
  async (source) => {
    f.tables.lessons[0].source_provider = source;
    const before = structuredClone(f.tables);
    await importCalendar("fixture", studio, [student]);
    await importCalendar("fixture", studio, [student]);
    await Promise.all([
      importCalendar("fixture", studio, [student]),
      importCalendar("fixture", studio, [student]),
    ]);
    expect(f.tables).toEqual(before);
    expect(counts()).toEqual([1, 1, 1, 1]);
    expect(f.writes).toEqual([]);
    expect(f.calls).toEqual([]);
  },
);
it("keeps unapproved linked occurrences in review without creating replacements", async () => {
  f.tables.integration_imports[0].status = "needs_review";
  await importCalendar("fixture", studio, [student]);
  expect(f.tables.integration_imports[0].status).toBe("needs_review");
  expect(counts()).toEqual([1, 1, 1, 1]);
  expect(f.calls).toEqual([]);
});
it("fails closed on import-read errors", async () => {
  f.readError = true;
  await expect(importCalendar("fixture", studio, [student])).rejects.toThrow(
    "Read failed",
  );
  expect(f.writes).toEqual([]);
  expect(f.calls).toEqual([]);
});
it("reviews a changed cross-signal time against the original lesson without overwriting its projection or spending credits", async () => {
  f.events[0].start.dateTime = "2031-11-02T20:00:00Z";
  f.events[0].end.dateTime = "2031-11-02T21:00:00Z";
  await importCalendar("fixture", studio, [student]);
  expect(f.tables.integration_imports[0]).toMatchObject({
    lesson_id: "approved-lesson",
    status: "needs_review",
    payload: { changeType: "reschedule" },
  });
  expect(f.tables.lessons[0].starts_at).toBe("2031-11-02T18:00:00Z");
  expect(counts()).toEqual([1, 1, 1, 1]);
  expect(f.calls).toEqual([]);
});
it("cancels only the linked occurrence through the established versioned command; repeat is harmless", async () => {
  f.events[0].status = "cancelled";
  await importCalendar("fixture", studio, [student]);
  await importCalendar("fixture", studio, [student]);
  expect(f.calls).toEqual([
    {
      name: "command_change_lesson_state",
      args: expect.objectContaining({
        p_lesson_id: "approved-lesson",
        p_expected_version: 4,
        p_action: "cancel",
      }),
    },
  ]);
  expect(counts()).toEqual([1, 1, 1, 1]);
});
it("imports a legitimate distinct event once, then preserves it on retry", async () => {
  f.events[0].id = "distinct-event";
  f.events[0].start.dateTime = "2031-11-04T18:00:00Z";
  f.events[0].end.dateTime = "2031-11-04T19:00:00Z";
  await importCalendar("fixture", studio, [student]);
  await importCalendar("fixture", studio, [student]);
  expect(counts()).toEqual([2, 2, 2, 2]);
  expect(
    f.tables.integration_imports.find(
      (r) => r.external_id === "calendar-signal",
    )?.lesson_id,
  ).toBe("approved-lesson");
});

it("fails closed when an approved link is unavailable instead of creating a replacement", async () => {
  f.tables.integration_imports[0].lesson_id = "unavailable";
  await expect(importCalendar("fixture", studio, [student])).rejects.toThrow(
    "Linked Calendar lesson is unavailable",
  );
  expect(f.writes).toEqual([]);
  expect(f.calls).toEqual([]);
});
it("preserves managed Calendar rescheduling through the existing versioned occurrence command", async () => {
  f.tables.calendar_projections[0].external_event_id = "calendar-signal";
  f.events[0].start.dateTime = "2031-11-02T20:00:00Z";
  f.events[0].end.dateTime = "2031-11-02T21:00:00Z";
  await importCalendar("fixture", studio, [student]);
  await importCalendar("fixture", studio, [student]);
  expect(f.calls).toEqual([
    {
      name: "command_change_lesson_state",
      args: expect.objectContaining({
        p_lesson_id: "approved-lesson",
        p_action: "reschedule",
        p_expected_version: 4,
        p_queue_calendar: false,
      }),
    },
  ]);
  expect(f.tables.lessons[0].starts_at).toBe("2031-11-02T20:00:00Z");
  expect(counts()).toEqual([1, 1, 1, 1]);
});
