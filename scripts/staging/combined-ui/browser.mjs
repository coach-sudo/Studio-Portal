import { setTimeout, clearTimeout } from "node:timers";
/* global history, dispatchEvent, PopStateEvent, requestAnimationFrame */
import { URL } from "node:url";
// Same driver for the future protected host and disposable SQL/browser lane.
// Every business submission is intercepted BEFORE transmission, checked by the
// executor, submitted once by its transport, then fulfilled with the real reply.
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { workspaceViews } from "./journeys.mjs";
import { plan, ids } from "./policy.mjs";

export class UiBrowserDriver {
  constructor({ executor, contexts, origin, readRequest, output }) {
    Object.assign(this, { e: executor, contexts, origin, readRequest, output });
    this.pages = {};
    this.failure = undefined;
    this.viewsDone = [];
  }
  async initialize() {
    for (const [role, context] of Object.entries(this.contexts)) {
      context.setDefaultTimeout(10000);
      context.setDefaultNavigationTimeout(20000);
      await context.routeWebSocket("**", (socket) => {
        this.failure = Error("WebSocket prohibited");
        socket.close();
      });
      await context.route("**/*", async (route) => {
        const request = route.request();
        try {
          const url = new URL(request.url());
          if (
            this.allowRevokedClaim &&
            role === "guardian" &&
            request.method() === "POST" &&
            url.origin === this.origin &&
            url.pathname === "/api/v2/auth/claim-access"
          ) {
            assert(!this.revokedClaimBlocked, "Repeated access-claim attempt");
            this.revokedClaimBlocked = true;
            this.e.journal.reserve(
              "http-business",
              plan.budgets.businessMutationRequests,
            );
            this.e.journal.reserve(
              "http-total",
              plan.budgets.httpMutationRequests,
            );
            this.e.journal.append({
              type: "expected-boundary-denial",
              name: "guardian:claim-access",
              transmitted: false,
            });
            await route.abort("blockedbyclient");
            return;
          }
          if (
            ["fonts.googleapis.com", "fonts.gstatic.com"].includes(
              url.hostname,
            ) &&
            request.method() === "GET"
          ) {
            this.e.browserRead();
            this.e.journal.append({
              type: "blocked-decoration",
              name: url.hostname,
            });
            await route.abort("blockedbyclient");
            return;
          }
          const body =
            request.method() === "POST" ? request.postDataJSON() : undefined;
          if (
            url.origin === this.origin &&
            ["/api/v2/students", "/api/v2/credits", "/api/v2/lessons"].includes(
              url.pathname,
            ) &&
            !["bulk_candidates", "bulk_progress", "record_history"].includes(
              body?.command,
            )
          ) {
            const armed = this.armed;
            assert(armed && role === "coach", "Unarmed browser mutation");
            assert.equal(url.pathname, armed.path);
            assert.equal(body.command, armed.body.command);
            if (armed.body.entityId)
              assert.equal(body.entityId, armed.body.entityId);
            if (body.command === "preview_bulk")
              assert.deepEqual(
                new Set(body.payload.selectedIds),
                new Set(armed.body.payload.selectedIds),
              );
            this.armed = undefined;
            const response = await this.e.http(
              armed.name,
              url.pathname,
              body,
              role,
            );
            this.lastBodies ||= new Map();
            this.lastBodies.set(armed.name, body);
            await route.fulfill({
              status: response.status,
              contentType: "application/json",
              body: JSON.stringify(response.body),
            });
            armed.resolve(response);
          } else await this.readRequest(route, role, this.e);
        } catch (error) {
          this.failure = error;
          this.armed?.reject(error);
          this.armed = undefined;
          await route.abort("blockedbyclient");
        }
      });
      this.pages[role] = await context.newPage();
    }
    this.page = this.pages.coach;
  }
  check() {
    if (this.failure) throw this.failure;
  }
  path(suffix = "") {
    return `/coach/students/${ids.student}${suffix}`;
  }
  async goto(path, role = "coach") {
    this.check();
    const page = this.pages[role];
    if (page.url().startsWith(this.origin + "/")) {
      // Keep the live application/context and its identity-scoped query cache.
      // Full refresh is covered separately; do not reload every lazy asset for
      // each deterministic route transition under the 600-request ceiling.
      await page.evaluate((path) => {
        // Preserve router-compatible indexes so POP/draft guards are exercised.
        history.pushState(
          {
            usr: null,
            key: crypto.randomUUID(),
            idx: (history.state?.idx ?? 0) + 1,
          },
          "",
          path,
        );
        dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
      }, path);
    } else await page.goto(this.origin + path);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.waitForLoadState("networkidle");
    this.check();
  }
  async command(name, path, body, work) {
    this.check();
    assert(!this.armed);
    this.e.journal.append({ type: "ui-step", name });
    let timer;
    const response = new Promise((resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(this.failure || Error("No reviewed UI submission: " + name)),
        20000,
      );
      this.armed = { name, path, body, resolve, reject };
    });
    // Attach a rejection handler immediately, even if an earlier selector fails.
    response.catch(() => {});
    try {
      await work();
      const result = await response;
      this.check();
      if (name === "UI07.cancel")
        await expect(this.page).toHaveURL(this.origin + this.path("/lessons"));
      if (
        [
          "UI02.profile",
          "UI03.create",
          "SETUP.total",
          "SETUP.auto",
          "UI08.revoke",
        ].includes(name)
      )
        await expect(this.page.getByRole("dialog")).toHaveCount(0);
      return result;
    } catch (error) {
      if (this.output)
        await this.page.screenshot({
          path: `${this.output}/failure-${name.replaceAll(".", "-")}.png`,
          fullPage: true,
        });
      throw error;
    } finally {
      clearTimeout(timer);
      this.armed = undefined;
    }
  }
  async closeDialog() {
    const dialog = this.page.getByRole("dialog");
    if (await dialog.count()) await this.page.keyboard.press("Escape");
  }
  async edit(body) {
    await this.goto(this.path(`/lessons/${body.entityId}`));
    await this.page
      .getByText("Payment, credits & lesson administration", { exact: true })
      .click();
    await this.page
      .getByRole("button", { name: "Edit lesson information", exact: true })
      .click();
    await this.page
      .getByLabel("Lesson topic", { exact: true })
      .fill(body.payload.topic);
    await this.page
      .getByRole("button", { name: "Save lesson information", exact: true })
      .click();
  }
  async select(idsToSelect, operation, reason) {
    await this.goto(
      this.path(
        `/lessons?lessonSize=10${operation === "restore" ? "&lessonArchived=true" : ""}`,
      ),
    );
    await expect(
      this.page.locator(".lesson-bulk-list .list-controls select"),
    ).toHaveValue("10");
    await expect(
      this.page.getByRole("list", { name: "Selectable lessons" }),
    ).toHaveAttribute("aria-busy", "false");
    // Use the actual pagination buttons. Full navigations would clear selection.
    for (const id of idsToSelect) {
      const row = this.e.ownRows("public.lessons").find((l) => l.id === id);
      assert(row);
      const checkbox = this.page.getByRole("checkbox", {
        name: "Select " + row.topic,
        exact: true,
      });
      if (!(await checkbox.count())) {
        const controls = this.page.locator(".lesson-bulk-list .list-controls");
        const next = controls.getByRole("button", {
          name: "Next",
          exact: true,
        });
        await (
          (await next.isEnabled())
            ? next
            : controls.getByRole("button", { name: "Previous", exact: true })
        ).click();
        await this.page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        await expect(
          this.page.getByRole("list", { name: "Selectable lessons" }),
        ).toHaveAttribute("aria-busy", "false");
      }
      await expect(checkbox).toBeVisible();
      await checkbox.check();
    }
    await expect(
      this.page.locator('[aria-label="Selected lesson actions"]'),
    ).toContainText(`${idsToSelect.length} selected`);
    await this.page
      .getByLabel("Bulk lesson action", { exact: true })
      .selectOption(operation);
    const dialog = this.page.getByRole("dialog");
    await dialog.getByLabel("Reason", { exact: true }).fill(reason);
    await dialog
      .getByRole("button", { name: "Review batch", exact: true })
      .click();
  }
  async submit(name, path, body) {
    // Duplicate wrapper probes reuse the ORIGINAL captured UI key and body.
    if (["UI04.replay", "UI05.accept-replay"].includes(name)) {
      const original =
        name === "UI05.accept-replay"
          ? this.lastBodies.get("UI05.accept")
          : name === "UI04.replay"
            ? this.lastBodies.get("UI04.apply")
            : body;
      assert(original);
      return this.e.http(name, path, original);
    }
    if (name === "UI02.profile") {
      const r = this.e
        .ownRows("public.students")
        .find((s) => s.id === ids.student);
      this.e.profilePayload = {
        fullName: r.full_name,
        preferredName: r.preferred_name || "",
        email: r.email,
        phone: r.phone || "",
        isMinor: r.is_minor,
        guardianName: r.is_minor ? r.guardian_name || "" : "",
        guardianEmail: r.is_minor ? r.guardian_email || "" : "",
        status: r.status,
        focusArea: plan.runId + " focus",
        goals: r.goals || "",
        privateNotes: r.private_notes || "",
        leadSource: r.lead_source || "",
        driveFolderUrl: r.drive_folder_url || "",
        tags: r.tags || [],
      };
    }
    if (name === "UI08.revoke") {
      const c = this.e
        .ownRows("public.linked_contacts")
        .find((c) => c.id === ids.contact);
      Object.assign(this.e.revokePayload, {
        isPrimaryPayer: c.is_primary_payer,
        isPrimarySchedulingContact: c.is_primary_scheduling_contact,
        receivesFinancialEscalations: c.receives_financial_escalations,
      });
    }
    return this.command(name, path, body, async () => {
      const p = this.page;
      if (name === "UI02.profile") {
        await this.goto(this.path());
        await p
          .getByRole("button", { name: "More actions", exact: true })
          .click();
        await p
          .getByRole("button", { name: "Edit details", exact: true })
          .click();
        await p
          .getByLabel("Focus area", { exact: true })
          .fill(plan.runId + " focus");
        await p
          .getByRole("button", { name: "Save details", exact: true })
          .click();
      } else if (name === "UI03.create") {
        await this.goto(this.path());
        await p
          .getByRole("button", { name: "Add lesson", exact: true })
          .click();
        const dialog = p.getByRole("dialog");
        await dialog
          .getByLabel("Lesson focus", { exact: true })
          .fill(body.payload.topic);
        const start = new Date(body.payload.startsAt);
        const formatted = new Intl.DateTimeFormat("sv-SE", {
          timeZone: "America/New_York",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
          .format(start)
          .replace(" ", "T");
        await dialog.getByLabel("Start", { exact: true }).fill(formatted);
        // The native form's reviewed default is 60 minutes; the intercepted
        // request independently enforces the exact one-hour interval.
        await dialog
          .getByRole("combobox", { name: /^Location/ })
          .selectOption("in_person");
        await dialog
          .getByLabel("In-person location", { exact: true })
          .fill("Synthetic staging room");
        await dialog
          .getByRole("combobox", { name: /^Repeat/ })
          .selectOption("none");
        await dialog
          .getByRole("button", { name: "Add lesson", exact: true })
          .click();
      } else if (["UI03.edit", "UI06.change"].includes(name))
        await this.edit(body);
      else if (name === "SETUP.total") {
        await this.goto(this.path("/payments"));
        await p
          .getByRole("button", { name: "Adjust credits", exact: true })
          .click();
        const dialog = p.getByRole("dialog");
        await dialog
          .getByRole("spinbutton", { name: /^Remaining total/ })
          .fill("4");
        await dialog
          .getByLabel("Reason", { exact: true })
          .fill(body.payload.reason);
        await dialog
          .getByRole("button", { name: "Save credit adjustment", exact: true })
          .click();
      } else if (name === "SETUP.auto") {
        await expect(p.getByRole("dialog")).toHaveCount(0);
        await p
          .getByRole("button", { name: "Review and enable", exact: true })
          .click();
        await p
          .getByRole("dialog")
          .getByRole("button", { name: "Confirm setting", exact: true })
          .click();
        await expect(p.getByRole("dialog")).toHaveCount(0);
      } else if (name === "UI04.apply")
        await p
          .getByRole("button", {
            name: "Apply eligible credits now",
            exact: true,
          })
          .click();
      else if (body.command === "preview_bulk")
        await this.select(
          body.payload.selectedIds,
          body.payload.operation,
          body.reason,
        );
      else if (body.command === "execute_bulk") {
        if (name === "UI06.accept")
          await this.goto(
            this.path(`/lessons?lessonBatch=${body.payload.jobId}`),
          );
        const dialog = p.getByRole("dialog");
        await dialog
          .getByRole("button", {
            name: /^(Confirm .+eligible\)|Permanently delete \d+ eligible lessons)$/,
          })
          .click();
      } else if (name === "UI07.preview") {
        await this.goto(this.path(`/lessons/${ids["lesson-cancel"]}`));
        await p
          .getByText("Payment, credits & lesson administration", {
            exact: true,
          })
          .click();
        await p
          .getByRole("button", { name: "Cancel lesson", exact: true })
          .click();
        const dialog = p.getByRole("dialog");
        await dialog.getByLabel("Reason", { exact: true }).fill(body.reason);
        await dialog
          .getByRole("combobox", { name: /^Change scope/ })
          .selectOption("occurrence");
        await dialog
          .getByRole("button", { name: "Review changes", exact: true })
          .click();
      } else if (name === "UI07.cancel")
        await p
          .getByRole("button", { name: "Confirm cancellation", exact: true })
          .click();
      else if (name === "UI08.revoke") {
        await this.goto(this.path("/household"));
        await p
          .getByRole("button", { name: "Manage Access", exact: true })
          .first()
          .click();
        const dialog = p.getByRole("dialog");
        const access = dialog.getByRole("checkbox", {
          name: "Allow this person to use the portal",
          exact: true,
        });
        await access.focus();
        await access.press("Space");
        await expect(access).not.toBeChecked();
        await expect(
          dialog.getByLabel("Receive optional notifications", { exact: true }),
        ).not.toBeChecked();
        await dialog
          .getByRole("button", { name: "Save contact", exact: true })
          .click();
      } else throw Error("No reviewed UI action: " + name);
    });
  }
  async reopen(jobId) {
    await this.goto(this.path(`/lessons?lessonBatch=${jobId}`));
    await expect(this.page.getByRole("dialog")).toContainText(/completed of/);
    await this.closeDialog();
  }
  async views(phase) {
    return workspaceViews(this, phase);
  }
}
