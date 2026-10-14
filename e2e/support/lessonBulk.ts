import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import type { E2ERuntime } from "./runtime";
import type {
  Database,
  TablesInsert,
} from "../../src/types/database.generated";

/** Service credentials and SQL are confined to the disposable loopback CI stack. */
export async function bulkFixture(
  runtime: E2ERuntime,
  count = 32,
  completed = false,
) {
  test.skip(
    process.env.USE_EPHEMERAL_STACK !== "true",
    "Bulk UI mutation evidence requires the isolated local stack.",
  );
  const url = process.env.SUPABASE_URL!;
  expect(new URL(url).hostname).toBe("127.0.0.1");
  expect(process.env.E2E_EPHEMERAL).toBe("true");
  const db = createClient<Database>(
    url,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const owner = await db
    .from("students")
    .select("studio_id")
    .eq("id", runtime.ids!.student)
    .single();
  expect(owner.error).toBeNull();
  const studioId = owner.data!.studio_id;
  const run = `${runtime.runId}-ui-${crypto.randomUUID().slice(0, 8)}`;
  const studentId = crypto.randomUUID(),
    secondStudent = crypto.randomUUID();
  const students = await db.from("students").insert(
    [studentId, secondStudent].map((id, i) => ({
      id,
      studio_id: studioId,
      full_name: `${run} Student ${i + 1}`,
      email: `${id}@example.test`,
      portal_enabled: false,
    })),
  );
  expect(students.error).toBeNull();
  const lessonIds = Array.from({ length: count }, () => crypto.randomUUID());
  const seriesIds: string[] = [],
    bookingIds: string[] = [];
  const rows: TablesInsert<"lessons">[] = lessonIds.map((id, i) => ({
    id,
    studio_id: studioId,
    student_id: studentId,
    topic: `${run} Lesson ${String(i + 1).padStart(4, "0")}${i === 0 ? " with a long title to verify responsive rows and accessible selection" : ""}`,
    starts_at: new Date(
      Date.now() + (120 * 24 + i * 2) * 3600000,
    ).toISOString(),
    ends_at: new Date(
      Date.now() + (120 * 24 + i * 2 + 1) * 3600000,
    ).toISOString(),
    status: completed ? "completed" : i < 3 ? "scheduled" : "cancelled",
    source_provider: "studio",
    location_type: "in_person",
    location_label: "Isolated fixture studio",
    payment_status: !completed && i === 2 ? "paid" : "untracked",
    paid_minor: !completed && i === 2 ? 3000 : 0,
  }));
  for (let offset = 0; offset < count; offset += 250) {
    const inserted = await db
      .from("lessons")
      .insert(rows.slice(offset, offset + 250));
    expect(inserted.error).toBeNull();
  }
  const sql = (query: string) => {
    const container = process.env.DB_CONTAINER || "";
    expect(container).toMatch(/^supabase_db_studio-portal/);
    return execFileSync(
      "docker",
      [
        "exec",
        container,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-Atc",
        query,
      ],
      { encoding: "utf8" },
    ).trim();
  };
  return {
    db,
    run,
    studioId,
    studentId,
    secondStudent,
    lessonIds,
    rows,
    seriesIds,
    bookingIds,
    sql,
    async work(jobId: string) {
      const claimed = await db.rpc("claim_lesson_bulk_items", {
        p_limit: 25,
        p_job: jobId,
      });
      expect(claimed.error).toBeNull();
      for (const claim of claimed.data as {
        id: string;
        claim_token: string;
      }[]) {
        const result = await db.rpc("process_lesson_bulk_item", {
          p_item: claim.id,
          p_token: claim.claim_token,
        });
        expect(result.error).toBeNull();
      }
    },
    async cleanup() {
      const outbox = await db
        .from("outbox_messages")
        .delete()
        .in("student_id", [studentId, secondStudent]);
      expect(outbox.error).toBeNull();
      for (const rpc of [
        "cleanup_lesson_bulk_fixture",
        "cleanup_lesson_change_fixture",
      ] as const) {
        const cleaned = await db.rpc(rpc, { p_run: run, p_studio: studioId });
        expect(cleaned.error).toBeNull();
      }
      for (let offset = 0; offset < count; offset += 100) {
        const ids = lessonIds.slice(offset, offset + 100);
        const audit = await db
          .from("audit_events")
          .delete()
          .in("entity_id", ids)
          .eq("studio_id", studioId);
        expect(audit.error).toBeNull();
        const participants = await db
          .from("lesson_participants")
          .delete()
          .in("lesson_id", ids);
        expect(participants.error).toBeNull();
        const lessons = await db
          .from("lessons")
          .delete()
          .in("id", ids)
          .eq("studio_id", studioId);
        expect(lessons.error).toBeNull();
      }
      if (bookingIds.length) {
        const b = await db.from("bookings").delete().in("id", bookingIds);
        expect(b.error).toBeNull();
      }
      if (seriesIds.length) {
        const s = await db
          .from("recurring_series")
          .delete()
          .in("id", seriesIds);
        expect(s.error).toBeNull();
      }
      const a = await db
        .from("audit_events")
        .delete()
        .in("entity_id", [studentId, secondStudent])
        .eq("studio_id", studioId);
      expect(a.error).toBeNull();
      const s = await db
        .from("students")
        .delete()
        .in("id", [studentId, secondStudent])
        .eq("studio_id", studioId);
      expect(s.error).toBeNull();
    },
  };
}

export function batchId(page: Page) {
  const id = new URL(page.url()).searchParams.get("lessonBatch")!;
  expect(id).toMatch(/^[a-f0-9-]{36}$/);
  return id;
}
export async function chooseBulkOperation(
  page: Page,
  operation: string,
  scope?: string,
) {
  await page
    .getByRole("combobox", { name: "Bulk lesson action" })
    .selectOption(operation);
  const form = page.getByRole("dialog");
  if (scope)
    await form.getByLabel("Scope", { exact: true }).selectOption(scope);
  await form
    .getByLabel("Reason", { exact: true })
    .fill("Erroneous isolated fixture review");
  await form.getByRole("button", { name: "Review batch", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText(/reviewed$/, { exact: false })
      .first(),
  ).toBeVisible({ timeout: 60000 });
}
