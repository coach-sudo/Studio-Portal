import { createClient } from "@supabase/supabase-js";
import { openAs, accessToken } from "./support/auth";
import { test, expect, requireFixtures } from "./support/fixtures";

test("@journey authenticated bulk backend deletes an eligible fixture, restores archive and denies portal actors", async ({
  browser,
  runtime,
}) => {
  requireFixtures(runtime);
  test.skip(
    process.env.USE_EPHEMERAL_STACK !== "true",
    "Bulk worker harness requires the ephemeral local stack.",
  );
  const url = process.env.SUPABASE_URL!;
  expect(new URL(url).hostname).toBe("127.0.0.1");
  const worker = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const coach = await openAs(browser, "coach"),
    student = await openAs(browser, "student");
  try {
    await coach.page.goto("/coach/today");
    const headers = {
      Authorization: `Bearer ${await accessToken(coach.page)}`,
    };
    const command = async (
      name: string,
      payload: Record<string, unknown>,
      key = crypto.randomUUID(),
    ) => {
      const response = await coach.context.request.post("/api/v2/lessons", {
        headers,
        data: {
          command: name,
          payload,
          expectedVersion: 0,
          reason: "Erroneous isolated fixture",
          idempotencyKey: key,
        },
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      return (await response.json()).resource;
    };
    const work = async (jobId: string) => {
      const claims = await worker.rpc("claim_lesson_bulk_items", {
        p_limit: 25,
        p_job: jobId,
      });
      expect(claims.error).toBeNull();
      for (const c of claims.data as unknown as {
        id: string;
        claim_token: string;
      }[]) {
        const processed = await worker.rpc("process_lesson_bulk_item", {
          p_item: c.id,
          p_token: c.claim_token,
        });
        expect(processed.error).toBeNull();
        expect(processed.data).toMatchObject({ status: "succeeded" });
      }
    };
    const deletion = await command("preview_bulk", {
      operation: "delete",
      selectedIds: [runtime.ids!.bulkDeleteLesson],
    });
    expect(deletion).toMatchObject({
      count: 1,
      eligible: 1,
      blocked: 0,
      notificationPolicy: "none",
    });
    const key = crypto.randomUUID();
    await command(
      "execute_bulk",
      { jobId: deletion.jobId, reviewToken: deletion.reviewToken },
      key,
    );
    await work(deletion.jobId);
    const result = await command("bulk_progress", {
      jobId: deletion.jobId,
      offset: 0,
      limit: 1,
    });
    expect(result.counts).toMatchObject({
      succeeded: 1,
      failed: 0,
      synchronizationPending: 0,
    });
    const history = await command("record_history", {
      lessonId: runtime.ids!.bulkDeleteLesson,
    });
    expect(history.lesson).toBeNull();
    expect(history.deletion.snapshot.lesson.id).toBe(
      runtime.ids!.bulkDeleteLesson,
    );
    expect(
      (
        await command(
          "execute_bulk",
          { jobId: deletion.jobId, reviewToken: deletion.reviewToken },
          key,
        )
      ).duplicate,
    ).toBe(true);
    for (const operation of ["archive", "restore"] as const) {
      const review = await command("preview_bulk", {
        operation,
        selectedIds: [runtime.ids!.bulkArchiveLesson],
      });
      await command("execute_bulk", {
        jobId: review.jobId,
        reviewToken: review.reviewToken,
      });
      await work(review.jobId);
      expect(
        (await command("bulk_progress", { jobId: review.jobId })).counts
          .succeeded,
      ).toBe(1);
    }
    await student.page.goto("/portal/bookings");
    const denied = await student.context.request.post("/api/v2/lessons", {
      headers: { Authorization: `Bearer ${await accessToken(student.page)}` },
      data: {
        command: "bulk_progress",
        expectedVersion: 0,
        reason: "Forged batch access",
        idempotencyKey: crypto.randomUUID(),
        payload: { jobId: deletion.jobId },
      },
    });
    expect(denied.status()).toBe(403);
  } finally {
    await coach.context.close();
    await student.context.close();
  }
});
