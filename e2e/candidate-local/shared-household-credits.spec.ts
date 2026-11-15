import { expect, test } from "@playwright/test";
import { ids, installFixture } from "./fixture";

test("coach reviews shared credit transfers and sees reservation conflicts", async ({
  page,
  context,
}, info) => {
  await installFixture(context, "coach");
  const id = "70000000-0000-4000-8000-000000000041";
  const group = "70000000-0000-4000-8000-000000000042";
  const person = { id: ids.student, name: "E2E Candidate Student" };
  const pool = {
    id,
    name: "Household Scene Study",
    householdId: group,
    householdName: "Candidate household",
    durationMinutes: 60,
    services: ["Scene Study"],
    expiresAt: "2027-01-19T18:00:00Z",
    unused: 3,
    reserved: 1,
    available: 2,
    consumed: 0,
    members: [person],
    usage: [],
  };
  const transfer = {
    packageId: id,
    packageName: pool.name,
    studentId: ids.student,
    durationMinutes: 60,
    sourceAvailable: 2,
    sourceReserved: 1,
    sourceAfter: 1,
    destinationAfter: 1,
  };
  let applyCount = 0;
  await context.route(
    "**/rest/v1/rpc/household_credit_access",
    async (route) => {
      const input = route.request().postDataJSON();
      if (input.p_action === "expiration_history")
        return route.fulfill({ json: [] });
      if (input.p_action === "expiration_preview")
        return route.fulfill({
          json: {
            packageId: id,
            oldExpiry: pool.expiresAt,
            newExpiry: null,
            balance: 2,
            reservations: [
              {
                lessonId: ids.lesson,
                topic: "Scene Study next week",
                startsAt: pool.expiresAt,
                coveredBefore: false,
                coveredAfter: true,
              },
            ],
          },
        });
      if (input.p_action === "expiration_apply") {
        expect(input.p_value.reason).toBe("Approved expiration waiver");
        return route.fulfill({ json: { status: "completed" } });
      }
      if (input.p_action === "coach") {
        return route.fulfill({
          json: {
            households: [
              {
                id: group,
                name: pool.householdName,
                members: [person],
                pools: [pool],
              },
            ],
            students: [person],
            definitions: [],
            transferLots: [
              { id, name: pool.name, studentId: null, householdId: group },
            ],
          },
        });
      }
      if (input.p_action === "membership_preview") {
        expect(input.p_value).toMatchObject({
          packageId: id,
          studentId: ids.student,
          eligible: false,
        });
        return route.fulfill({
          json: {
            status: "preview",
            canApply: false,
            conflicts: [{ id: ids.lesson, topic: "Scene Study next week" }],
          },
        });
      }
      if (input.p_action === "transfer_preview") {
        expect(input.p_value).toMatchObject({
          packageId: id,
          studentId: ids.student,
          quantity: 1,
        });
        return route.fulfill({
          json: { ...transfer, status: "preview", canApply: true },
        });
      }
      expect(input.p_action).toBe("transfer_apply");
      expect(input.p_value).toMatchObject({
        preview: transfer,
        reason: "Approved household transfer",
      });
      applyCount += 1;
      return route.fulfill({ json: { status: "completed" } });
    },
  );
  await page.goto("/coach/finance");
  await page
    .getByRole("button", { name: "Household credits", exact: true })
    .click();
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Household credits" }) });
  await dialog
    .getByRole("combobox", { name: "Action", exact: true })
    .selectOption("membership");
  await dialog
    .getByRole("combobox", { name: "Household", exact: true })
    .selectOption(group);
  await dialog
    .getByRole("combobox", { name: "Shared package", exact: true })
    .selectOption(id);
  await dialog
    .getByRole("combobox", { name: "Student", exact: true })
    .selectOption(ids.student);
  await dialog
    .getByRole("combobox", { name: "Eligibility", exact: true })
    .selectOption("false");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Reviewed pool eligibility");
  await dialog.getByRole("button", { name: "Preview change" }).click();
  await expect(
    dialog.getByText("Scene Study next week has a reservation in this pool."),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Confirm change" }),
  ).toHaveCount(0);
  await dialog
    .getByRole("combobox", { name: "Action", exact: true })
    .selectOption("transfer");
  await dialog
    .getByRole("combobox", { name: "Source package", exact: true })
    .selectOption(id);
  await dialog
    .getByRole("combobox", { name: "Recipient", exact: true })
    .selectOption(ids.student);
  await dialog.getByLabel("Credit quantity", { exact: true }).fill("1");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Approved household transfer");
  await dialog.getByRole("button", { name: "Preview change" }).click();
  await expect(dialog.getByText(/Source availability 2 → 1/)).toBeVisible();
  expect(applyCount).toBe(0);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("household-transfer.png") });
  await dialog.getByRole("button", { name: "Confirm change" }).click();
  await expect(
    dialog.getByText("Household credit change saved."),
  ).toBeVisible();
  expect(applyCount).toBe(1);
  await dialog
    .locator("summary")
    .filter({ hasText: "Candidate household" })
    .click();
  await dialog.getByRole("button", { name: "Manage expiration" }).click();
  const expiry = page
    .getByRole("dialog")
    .filter({
      has: page.getByRole("heading", { name: "Manage credit expiration" }),
    })
    .last();
  await expiry.getByRole("combobox", { name: "Action" }).selectOption("waive");
  await expiry
    .getByRole("textbox", { name: "Reason" })
    .fill("Approved expiration waiver");
  await expiry
    .getByRole("button", { name: "Preview expiration change" })
    .click();
  await expect(expiry.getByText(/Outside expiry → Valid/)).toBeVisible();
  await expiry.screenshot({ path: info.outputPath("expiration-preview.png") });
  await expiry
    .getByRole("button", { name: "Confirm expiration change" })
    .click();
  await expect(expiry.getByText("Expiration change saved.")).toBeVisible();
});
