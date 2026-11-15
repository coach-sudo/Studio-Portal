import { expect, test } from "@playwright/test";
import { ids, installFixture } from "./fixture";

const packageId = "60000000-0000-4000-8000-000000000001";
const fixturePackage = {
  id: packageId,
  studentId: ids.student,
  name: "Scene study package",
  durationMinutes: 60,
  serviceIds: [],
  services: ["Scene study"],
  expiresAt: null,
  issued: 5,
  purchased: 4,
  consumed: 1,
  held: 1,
  reserved: 1,
  unused: 4,
  available: 3,
  ledgerBalance: 3,
  issues: ["unverified_reservation_eligibility"],
  purchaseReferences: ["synthetic-purchase"],
};
const baseEntry = {
  reason: "Synthetic ledger",
  createdAt: "2026-10-15T12:00:00Z",
  topic: null,
  sourceKey: null,
  correctedBy: null,
  corrects: null,
};
const entries = [
  {
    ...baseEntry,
    id: "61000000-0000-4000-8000-000000000001",
    kind: "adjustment",
    quantity: 1,
    action: "reverse",
  },
  {
    ...baseEntry,
    id: "61000000-0000-4000-8000-000000000002",
    kind: "reservation",
    quantity: -1,
    action: "restore",
    topic: "Completed coaching",
  },
];

test("coach reviews package corrections and reservation conflicts", async ({
  page,
  context,
}, info) => {
  await installFixture(context, "coach");
  const corrections: unknown[] = [];
  const reconciliation = {
    id: "61000000-0000-4000-8000-000000000009",
    finding: "unverified_reservation_eligibility",
    status: "needs_review",
    version: 1,
    reason: null as string | null,
    history: [] as { at: string; reason: string; status: string }[],
  };
  await context.route("**/api/v2/credits", async (route) => {
    const { command, payload } = route.request().postDataJSON();
    if (command === "package_correct") corrections.push(payload);
    if (command === "case_decide") {
      reconciliation.status = payload.status;
      reconciliation.version++;
      reconciliation.reason = payload.reason;
      reconciliation.history.push({
        at: "2026-10-15T12:00:00Z",
        reason: payload.reason,
        status: payload.status,
      });
      return route.fulfill({ json: { resource: { case: reconciliation } } });
    }
    if (command !== "package_review") return route.fallback();
    return route.fulfill({
      json: {
        resource: {
          studentId: ids.student,
          version: 4,
          page: 1,
          lots: [fixturePackage],
          selected: payload.packageId ? fixturePackage : null,
          cases: payload.packageId ? [reconciliation] : [],
          entries: payload.packageId ? entries : [],
          total: payload.packageId ? entries.length : 0,
          reservations: payload.packageId
            ? [
                {
                  id: ids.lesson,
                  topic: "Upcoming protected lesson",
                  startsAt: "2026-12-10T18:00:00Z",
                  quantity: 1,
                },
              ]
            : [],
        },
      },
    });
  });
  await page.goto("/coach/students/" + ids.student + "/payments");
  await page.getByText("Packages and reconciliation", { exact: true }).click();
  await page.getByLabel("Student package").selectOption(packageId);
  await expect(
    page.getByRole("heading", { name: "Scene study package" }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Reconciliation findings" }),
  ).toContainText("incompatible or unverified");
  await page.getByText("Reservations", { exact: true }).click();
  await expect(page.getByText(/Upcoming protected lesson/)).toBeVisible();
  await page
    .getByRole("heading", { name: "Scene study package" })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: info.outputPath("package-review.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Remove package credits" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("spinbutton").fill("4");
  await expect(dialog.getByRole("alert")).toContainText(
    "Upcoming protected lesson",
  );
  await expect(
    dialog.getByRole("button", { name: "Review correction" }),
  ).toBeDisabled();
  await page.screenshot({ path: info.outputPath("reservation-conflict.png") });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  for (const [action, image, balance] of [
    ["Reverse entry", "reverse-preview.png", "Unused credits: 4 to 3"],
    [
      "Restore consumed credit",
      "restore-preview.png",
      "Unused credits: 4 to 5",
    ],
  ] as const) {
    await page.getByRole("button", { name: action }).click();
    dialog = page.getByRole("dialog", { name: action });
    await dialog.getByLabel("Reason").fill("Reviewed synthetic source");
    await dialog.getByRole("button", { name: "Review correction" }).click();
    await expect(dialog.getByText(balance)).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Confirm correction" }),
    ).toBeVisible();
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(image) });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: action })).toBeFocused();
  }
  const cases = page.getByRole("region", { name: "Reconciliation cases" });
  await cases.getByText(/^Needs review/).click();
  await cases
    .getByLabel("Review reason")
    .fill("Confirmed synthetic reservation context");
  await cases.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(cases.getByText(/^Dismissed/)).toBeVisible();
  await expect(
    cases.getByText(/Confirmed synthetic reservation context/),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("case-decision.png") });
  expect(corrections).toHaveLength(0);
});
