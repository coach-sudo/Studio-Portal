import { openAs, accessToken } from "./support/auth";
import { storageStatePath } from "./support/runtime";
import { expectNoSeriousAxeViolations } from "./support/axe";
import {
  bulkFixture,
  batchId,
  chooseBulkOperation,
} from "./support/lessonBulk";
import {
  test,
  expect,
  requireFixtures,
  expectNoHorizontalOverflow,
} from "./support/fixtures";

test.use({ trace: "retain-on-failure" });

test("@journey @mobile @a11y select across pages, delete eligible mistakes, preserve protected history, archive and restore", async ({
  browser,
  runtime,
}, info) => {
  requireFixtures(runtime);
  test.setTimeout(180000);
  const f = await bulkFixture(runtime);
  const mobile = info.project.name.startsWith("mobile");
  const context = await browser.newContext({
    baseURL: runtime.baseURL,
    bypassCSP: process.env.E2E_EPHEMERAL === "true",
    storageState: storageStatePath("coach"),
    isMobile: mobile,
    hasTouch: mobile,
    viewport: { width: mobile ? 390 : 1440, height: 1000 },
  });
  const coach = { context, page: await context.newPage() },
    page = coach.page;
  page.setDefaultTimeout(15000);
  const route = `/coach/students/${f.studentId}/lessons`;
  try {
    await page.goto(route);
    const rows = page.locator(".bulk-lesson-rows input[type=checkbox]");
    await expect(rows).toHaveCount(25);
    if (mobile) await page.locator(".bulk-row-select").first().tap();
    else await rows.nth(0).check();
    await rows.nth(1).check();
    await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(rows).toHaveCount(7);
    await rows.first().check();
    await expect(page.getByText("3 selected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(rows).toHaveCount(25);
    await expect(rows.first()).toBeChecked();
    await page.getByRole("button", { name: "Clear selection" }).click();
    await page.getByLabel("Select all visible", { exact: true }).check();
    await expect(page.getByText("25 selected", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Select all 32 matching lessons" })
      .click();
    await rows.first().uncheck();
    await expect(
      page.getByText("31 selected across matching results", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Search lesson titles").fill("Lesson 0001");
    await expect(
      page.getByText(
        "Selection cleared because the lesson filters or student changed.",
      ),
    ).toBeAttached();
    await expect(
      page.getByRole("region", { name: "Selected lesson actions" }),
    ).toHaveCount(0);
    await page.getByLabel("Search lesson titles").fill("");
    await expect(rows).toHaveCount(25);
    for (const n of [0, 1, 2]) await rows.nth(n).check();
    // Keyboard opens the shared form and Escape restores the initiating control.
    const action = page.getByRole("combobox", { name: "Bulk lesson action" });
    await action.focus();
    await action.selectOption("delete");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(action).toBeFocused();
    await chooseBulkOperation(page, "delete");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("2 eligible", { exact: true })).toBeVisible();
    await expect(dialog.getByText("1 blocked", { exact: true })).toBeVisible();
    await expect(
      dialog.getByText("Payment or invoice history must be preserved."),
    ).toBeVisible();
    await expectNoSeriousAxeViolations(page, '[role="dialog"]');
    for (const width of info.project.name.startsWith("mobile")
      ? [390]
      : [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: info.outputPath(`bulk-delete-review-${width}.png`),
        fullPage: true,
      });
    }
    const job = batchId(page);
    const protectedBefore = await f.db
      .from("lessons")
      .select("*")
      .eq("id", f.lessonIds[2])
      .single();
    await dialog
      .getByRole("button", {
        name: "Permanently delete 2 eligible lessons",
        exact: true,
      })
      .click();
    await expect(dialog.getByText(/Batch accepted/)).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("dialog").getByText("2 waiting", { exact: true }),
    ).toBeVisible();
    await f.work(job);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Refresh status" })
      .click();
    await expect(
      page.getByText("2 completed of 3", { exact: true }),
    ).toBeVisible();
    const deleted = await f.db
      .from("lessons")
      .select("id")
      .in("id", f.lessonIds.slice(0, 2));
    expect(deleted.data).toEqual([]);
    expect(
      (await f.db.from("lessons").select("*").eq("id", f.lessonIds[2]).single())
        .data,
    ).toEqual(protectedBefore.data);
    const firstResult = page.locator(".bulk-review-row").first();
    await firstResult
      .getByText("Consequences and history", { exact: true })
      .click();
    await firstResult
      .getByRole("button", { name: "View record history" })
      .click();
    await expect(
      page.getByText("The audit and deletion snapshot are retained.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("lesson.bulk_delete", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .last()
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(rows).toHaveCount(25);
    await expect(
      page.getByRole("link", { name: f.rows[0].topic, exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Reopen latest batch" }).click();
    await expect(
      page.getByText("2 completed of 3", { exact: true }),
    ).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByLabel("Search lesson titles").fill("Lesson 0004");
    await expect(rows).toHaveCount(1);
    await rows.first().check();
    await chooseBulkOperation(page, "archive");
    const archive = batchId(page);
    await page
      .getByRole("button", {
        name: "Confirm archive lessons (1 eligible)",
        exact: true,
      })
      .click();
    await expect(page.getByText(/Batch accepted/)).toBeVisible();
    await f.work(archive);
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect(
      page.getByText("1 completed of 1", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(rows).toHaveCount(0);
    await page.getByLabel("Include archived", { exact: true }).check();
    await expect(rows).toHaveCount(1);
    await expect(
      page.getByText("Archived · cancelled", { exact: true }),
    ).toBeVisible();
    await rows.first().check();
    await chooseBulkOperation(page, "restore");
    const restore = batchId(page);
    await page
      .getByRole("button", {
        name: "Confirm restore archived lessons (1 eligible)",
        exact: true,
      })
      .click();
    await expect(page.getByText(/Batch accepted/)).toBeVisible();
    await f.work(restore);
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect(
      page.getByText("1 completed of 1", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.getByText("Archived · cancelled", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Search lesson titles")).toHaveValue(
      "Lesson 0004",
    );
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxeViolations(page, ".lesson-bulk-list");
    await page.screenshot({
      path: info.outputPath("bulk-restored-list.png"),
      fullPage: true,
    });
    for (const role of ["student", "guardian"] as const) {
      const actor = await openAs(browser, role);
      try {
        await actor.page.goto("/portal/bookings");
        for (const [command, payload] of [
          ["bulk_progress", { jobId: job }],
          ["record_history", { lessonId: f.lessonIds[0] }],
          [
            "preview_bulk",
            { operation: "delete", selectedIds: [f.lessonIds[2]] },
          ],
        ] as const) {
          const response = await actor.context.request.post("/api/v2/lessons", {
            headers: {
              Authorization: `Bearer ${await accessToken(actor.page)}`,
            },
            data: {
              command,
              payload,
              expectedVersion: 0,
              reason: "Forged fixture access",
              idempotencyKey: crypto.randomUUID(),
            },
          });
          expect(response.status()).toBe(403);
        }
        await actor.page.goto(
          `/coach/bookings?calendarView=list&lessonBatch=${job}`,
        );
        await expect(actor.page).toHaveURL(/\/portal/);
        await expect(
          actor.page.getByRole("combobox", { name: "Bulk lesson action" }),
        ).toHaveCount(0);
      } finally {
        await actor.context.close();
      }
    }
  } finally {
    try {
      await f.cleanup();
    } finally {
      await coach.context.close();
    }
  }
});

test("@journey real partial success, dependency conflict, exhausted lease and safe failed-only retry", async ({
  browser,
  runtime,
}, info) => {
  requireFixtures(runtime);
  test.setTimeout(120000);
  const f = await bulkFixture(runtime, 3, true),
    coach = await openAs(browser, "coach"),
    page = coach.page;
  page.setDefaultTimeout(15000);
  try {
    const keys: string[] = [];
    let lost = false,
      executions = 0;
    await page.route("**/api/v2/lessons", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.command === "execute_bulk") executions++;
      if (body?.command === "preview_bulk") {
        keys.push(body.idempotencyKey);
        if (!lost) {
          lost = true;
          const response = await route.fetch();
          expect(response.ok()).toBeTruthy();
          await route.abort("failed");
          return;
        }
      }
      await route.continue();
    });
    await page.goto(
      `/coach/bookings?view=calendar&calendarView=list&lessonQuery=${encodeURIComponent(f.run)}`,
    );
    await page.getByLabel("Select all visible", { exact: true }).check();
    await page
      .getByRole("combobox", { name: "Bulk lesson action" })
      .selectOption("archive");
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Erroneous isolated fixture review");
    await page
      .getByRole("button", { name: "Review batch", exact: true })
      .click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page
      .getByRole("button", { name: "Review batch", exact: true })
      .click();
    await expect(page.getByText("3 reviewed", { exact: true })).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
    const job = batchId(page);
    await page
      .getByRole("button", {
        name: "Confirm archive lessons (3 eligible)",
        exact: true,
      })
      .click();
    await expect(page.getByText(/Batch accepted/)).toBeVisible();
    await page.reload();
    await expect(page.getByText("3 waiting", { exact: true })).toBeVisible();
    expect(executions).toBe(1);
    const changed = await f.db
      .from("lessons")
      .update({ topic: `${f.run} Changed after review` })
      .eq("id", f.lessonIds[1]);
    expect(changed.error).toBeNull();
    const claims = await f.db.rpc("claim_lesson_bulk_items", {
      p_limit: 25,
      p_job: job,
    });
    expect(claims.error).toBeNull();
    const pending = JSON.parse(
      f.sql(
        `select jsonb_agg(jsonb_build_object('id',id,'lessonId',lesson_id,'token',claim_token)) from lesson_ops.lesson_bulk_items where job_id='${job}'`,
      ),
    ) as { id: string; lessonId: string; token: string }[];
    for (const item of pending.filter((p) => p.lessonId !== f.lessonIds[2])) {
      expect(
        (
          await f.db.rpc("process_lesson_bulk_item", {
            p_item: item.id,
            p_token: item.token,
          })
        ).error,
      ).toBeNull();
    }
    f.sql(
      `update lesson_ops.lesson_bulk_items set attempts=5,claim_until=now()-interval '1 minute' where job_id='${job}' and lesson_id='${f.lessonIds[2]}'`,
    );
    expect(
      (await f.db.rpc("claim_lesson_bulk_items", { p_limit: 1, p_job: job }))
        .error,
    ).toBeNull();
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect(
      page.getByText("1 completed of 3", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("1 conflicted", { exact: true })).toBeVisible();
    await expect(page.getByText("1 failed", { exact: true })).toBeVisible();
    await page.screenshot({
      path: info.outputPath("bulk-partial-results.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Retry 1 failed items", exact: true })
      .click();
    await expect(page.getByText(/1 failed items queued/)).toBeVisible();
    await f.work(job);
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect(
      page.getByText("2 completed of 3", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("1 conflicted", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry 0 failed items", exact: true }),
    ).toBeDisabled();
    await expectNoSeriousAxeViolations(page, '[role="dialog"]');
    expect(
      f.sql(
        `select count(*) from audit_events where studio_id='${f.studioId}' and action='lesson.bulk_archive' and entity_id in ('${f.lessonIds[0]}','${f.lessonIds[2]}')`,
      ),
    ).toBe("2");
  } finally {
    try {
      await f.cleanup();
    } finally {
      await coach.context.close();
    }
  }
});

test("@journey recurring scope and shared prepaid/class cancellation protections use the existing backend", async ({
  browser,
  runtime,
}, info) => {
  requireFixtures(runtime);
  test.setTimeout(120000);
  const f = await bulkFixture(runtime, 4),
    coach = await openAs(browser, "coach"),
    page = coach.page;
  page.setDefaultTimeout(15000);
  try {
    const series = crypto.randomUUID(),
      booking = crypto.randomUUID();
    f.seriesIds.push(series);
    f.bookingIds.push(booking);
    expect(
      (
        await f.db.from("recurring_series").insert({
          id: series,
          studio_id: f.studioId,
          student_id: f.studentId,
          service_id: runtime.ids!.freeService,
          kind: "fixed",
          cadence: "weekly",
          starts_on: f.rows[0].starts_at,
          payment_policy: "pay_later",
          status: "active",
          occurrence_count: 2,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await f.db
          .from("lessons")
          .update({ series_id: series })
          .in("id", f.lessonIds.slice(0, 2))
      ).error,
    ).toBeNull();
    expect(
      (
        await f.db.from("bookings").insert({
          id: booking,
          studio_id: f.studioId,
          student_id: f.studentId,
          service_id: runtime.ids!.freeService,
          series_id: series,
          reference: `${f.run}-shared`,
          guest_name: `${f.run} Student`,
          guest_email: `${f.studentId}@example.test`,
          starts_at: f.rows[0].starts_at,
          ends_at: f.rows[0].ends_at,
          timezone: "America/New_York",
          location: "in_person",
          status: "confirmed",
          payment_policy: "pay_now",
          payment_status: "paid",
          total_minor: 3000,
          paid_minor: 3000,
          manage_token_hash: `${f.run}-token`,
          policy_snapshot: { cancellationWindowHours: 36, rescheduleLimit: 5 },
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await f.db.from("lesson_participants").insert(
          f.lessonIds.slice(0, 2).map((lesson_id) => ({
            lesson_id,
            student_id: f.studentId,
            booking_id: booking,
            display_name: `${f.run} Student`,
            email: `${f.studentId}@example.test`,
            status: "confirmed",
          })),
        )
      ).error,
    ).toBeNull();
    expect(
      (
        await f.db
          .from("lessons")
          .update({ capacity: 2, paid_minor: 0, payment_status: "untracked" })
          .eq("id", f.lessonIds[2])
      ).error,
    ).toBeNull();
    expect(
      (
        await f.db.from("lesson_participants").insert(
          [f.studentId, f.secondStudent].map((student_id) => ({
            lesson_id: f.lessonIds[2],
            student_id,
            display_name: `${f.run} Class student`,
            email: `${student_id}@example.test`,
            status: "confirmed",
          })),
        )
      ).error,
    ).toBeNull();
    await page.goto(
      `/coach/students/${f.studentId}/lessons?lessonQuery=Lesson%200001`,
    );
    await page.getByLabel("Select all visible", { exact: true }).check();
    await chooseBulkOperation(page, "cancel");
    await expect(
      page.getByText(
        "This prepaid booking covers multiple occurrences. Review settlement at booking level.",
      ),
    ).toBeVisible();
    await expect(page.getByText("0 eligible", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    expect(
      (
        await f.db
          .from("bookings")
          .update({
            payment_policy: "pay_later",
            payment_status: "due",
            paid_minor: 0,
          })
          .eq("id", booking)
      ).error,
    ).toBeNull();
    await chooseBulkOperation(page, "cancel", "future");
    await expect(page.getByText("2 reviewed", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/Stops future generation for the reviewed series/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await chooseBulkOperation(page, "cancel");
    await expect(page.getByText(/Scope: Selected occurrences/)).toBeVisible();
    await page
      .locator(".bulk-review-row")
      .first()
      .getByText("Consequences and history", { exact: true })
      .click();
    await expect(
      page.getByText(
        "Shared booking: 1 unaffected active occurrences remain valid.",
      ),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("bulk-occurrence-review.png"),
      fullPage: true,
    });
    const job = batchId(page);
    const unaffected = await f.db
      .from("lessons")
      .select("*")
      .eq("id", f.lessonIds[1])
      .single();
    await page
      .getByRole("button", {
        name: "Confirm cancel lessons (1 eligible)",
        exact: true,
      })
      .click();
    await expect(page.getByText(/Batch accepted/)).toBeVisible();
    await f.work(job);
    await page.getByRole("button", { name: "Refresh status" }).click();
    await expect(
      page.getByText("1 completed of 1", { exact: true }),
    ).toBeVisible();
    expect(
      (await f.db.from("lessons").select("*").eq("id", f.lessonIds[1]).single())
        .data,
    ).toEqual(unaffected.data);
    expect(
      (
        await f.db
          .from("bookings")
          .select("status,paid_minor")
          .eq("id", booking)
          .single()
      ).data,
    ).toMatchObject({ status: "confirmed", paid_minor: 0 });
    expect(
      (
        await f.db
          .from("recurring_series")
          .select("status")
          .eq("id", series)
          .single()
      ).data?.status,
    ).toBe("active");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByLabel("Search lesson titles").fill("Lesson 0003");
    await page.getByLabel("Select all visible", { exact: true }).check();
    await chooseBulkOperation(page, "cancel");
    await expect(
      page.getByText(
        "Open the class in the studio calendar and review a whole-class change.",
      ),
    ).toBeVisible();
    await page.goto(
      `/coach/bookings?view=calendar&calendarView=list&lessonQuery=${encodeURIComponent(f.run + " Lesson 0003")}`,
    );
    await page.getByLabel("Select all visible", { exact: true }).check();
    await page
      .getByRole("combobox", { name: "Bulk lesson action" })
      .selectOption("cancel");
    await page.getByLabel("Review as whole-class operation").check();
    await page
      .getByLabel("Reason", { exact: true })
      .fill("Review isolated class fixture");
    await page
      .getByRole("button", { name: "Review batch", exact: true })
      .click();
    await expect(page.getByText("1 eligible", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/all participants of each eligible class are affected/),
    ).toBeVisible();
    expect(
      (
        await f.db
          .from("lesson_participants")
          .select("student_id,status")
          .eq("lesson_id", f.lessonIds[2])
      ).data,
    ).toHaveLength(2);
  } finally {
    try {
      await f.cleanup();
    } finally {
      await coach.context.close();
    }
  }
});

test("@journey bounded all-matching review near the 5,000-record limit", async ({
  browser,
  runtime,
}, info) => {
  requireFixtures(runtime);
  test.setTimeout(240000);
  const f = await bulkFixture(runtime, 5000, true),
    coach = await openAs(browser, "coach"),
    page = coach.page;
  page.setDefaultTimeout(15000);
  const payloadSizes: number[] = [];
  try {
    page.on("response", async (response) => {
      if (response.url().endsWith("/api/v2/lessons")) {
        const request = response.request().postDataJSON();
        if (
          ["bulk_progress", "bulk_candidates"].includes(request?.command) &&
          response.ok()
        ) {
          const body = await response.json();
          payloadSizes.push(body.resource.items.length);
          expect(body.resource.items.length).toBeLessThanOrEqual(
            request.payload.limit,
          );
          expect(request.payload.limit).toBeLessThanOrEqual(100);
        }
      }
    });
    await page.goto(`/coach/students/${f.studentId}/lessons`);
    await expect(page.locator(".bulk-lesson-rows > li")).toHaveCount(25);
    await page
      .getByRole("button", { name: "Select all 5000 matching lessons" })
      .click();
    await page
      .locator(".bulk-lesson-rows input[type=checkbox]")
      .first()
      .uncheck();
    await expect(
      page.getByText("4999 selected across matching results", { exact: true }),
    ).toBeVisible();
    await chooseBulkOperation(page, "archive");
    await expect(
      page.getByText("4999 reviewed", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/reviewed matching set is frozen across all pages/),
    ).toBeVisible();
    await expect(page.locator(".bulk-review-row")).toHaveCount(25);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Next", exact: true })
      .click();
    await expect(
      page.getByRole("dialog").getByText("26–50 of 4999", { exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 768, height: 1024 });
    await expectNoHorizontalOverflow(page);
    await expectNoSeriousAxeViolations(page, '[role="dialog"]');
    await page.screenshot({
      path: info.outputPath("bulk-large-review-tablet.png"),
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByText("4999 reviewed", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Confirm archive lessons (4999 eligible)",
        exact: true,
      }),
    ).toBeEnabled();
    expect(payloadSizes.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...payloadSizes)).toBeLessThanOrEqual(25);
    expect(
      f.sql(
        `select count(*) from lesson_ops.lesson_bulk_items where job_id='${batchId(page)}'`,
      ),
    ).toBe("4999");
    // No acceptance or mutation is needed to validate a large frozen review.
  } finally {
    try {
      await f.cleanup();
    } finally {
      await coach.context.close();
    }
  }
});
