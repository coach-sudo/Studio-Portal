// Proposal generator only. No credentials, network, SQL or execution capability.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
export const runId = "e2e-wave1-ui-20261017-a";
export function plannedUiId(name) {
  const hex = createHash("sha256")
    .update(`${runId}:${name}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = "a";
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ]
    .map((p) => p.join(""))
    .join("-");
}
export const plan = {
  status: "PROPOSAL_ONLY_NOT_AUTHORIZED",
  runId,
  target: {
    site: "d83ff6cb-f57b-4741-8c3c-3eaae7adab19",
    project: "lrxrivfqjpkvygozphoz",
    studio: "4ceff683-e72f-4b2e-96ce-85db2dca4eb2",
    deployment: null,
    candidate: null,
  },
  accounts: Object.fromEntries(
    ["coach", "student", "guardian", "unrelated"].map((role) => [
      role,
      {
        id: plannedUiId(`auth-${role}`),
        email: `${runId}-${role}@coachd-staging.example.test`,
        createConfirmedWithoutEmail: true,
      },
    ]),
  ),
  records: Object.fromEntries(
    [
      "student",
      "other-student",
      "contact",
      "relationship",
      "service",
      "package",
      "lesson-edit",
      "lesson-credit",
      "lesson-cancel",
      "lesson-archive",
      "lesson-delete",
      "lesson-protected",
      "lesson-page-07",
      "lesson-page-08",
      "lesson-page-09",
      "lesson-page-10",
      "lesson-page-11",
      "lesson-page-12",
    ].map((name) => [name, plannedUiId(name)]),
  ),
  budgets: {
    authUsers: 4,
    students: 2,
    contacts: 1,
    relationships: 1,
    memberships: 3,
    services: 1,
    packageLots: 1,
    creditsGranted: 4,
    cashMinor: 0,
    lessonPriceMinor: 0,
    currency: "USD",
    seededLessons: 12,
    uiCreatedLessons: 1,
    lessonsTotal: 13,
    reviewedBatchMaximum: 13,
    bulkReviews: 4,
    httpMutationRequests: 30,
    canonicalSqlRequests: 60,
    readRequests: 600,
    cleanupTransactions: 40,
    authMutationRequests: 8,
    businessRowsPeak: 384,
    cumulativeBusinessRowIdentities: 512,
    providerCalls: 0,
    messagesDelivered: 0,
    scheduledWorkers: 0,
  },
  fixtureContent: {
    initialAutoApply: false,
    package: {
      id: plannedUiId("package"),
      name: "Studio lesson credits",
      expiresAt: null,
      initialCredits: 0,
      priceMinor: 0,
      currency: "USD",
    },
    lessons: [
      ["lesson-edit", "scheduled", "2027-01-20"],
      ["lesson-credit", "scheduled", "2027-01-21"],
      ["lesson-cancel", "scheduled", "2027-01-22"],
      ["lesson-archive", "cancelled", "2026-10-02"],
      ["lesson-delete", "cancelled", "2026-10-01"],
      ["lesson-protected", "completed", "2026-10-03"],
      ...Array.from({ length: 6 }, (_, i) => [
        `lesson-page-${String(i + 7).padStart(2, "0")}`,
        "cancelled",
        `2026-09-${String(i + 10).padStart(2, "0")}`,
      ]),
    ].map(([name, status, date]) => ({
      name,
      id: plannedUiId(name),
      studentId: plannedUiId("student"),
      status,
      topic: `${runId} ${name}`,
      startsAt: `${date}T18:00:00Z`,
      endsAt: `${date}T19:00:00Z`,
      locationType: "in_person",
      locationLabel: "Synthetic staging room",
      priceMinor: 0,
      paidMinor: 0,
      paymentStatus: "unpaid",
      externalIdentity: null,
    })),
    uiCreate: {
      startsAt: "2027-02-01T18:00:00Z",
      endsAt: "2027-02-01T19:00:00Z",
      locationType: "in_person",
      recurrence: "none",
      priceMinor: null,
      expectedFinancialReviewBeforeCoverage: true,
      generatedIdsMaximum: 1,
    },
    notificationPreferences:
      "disabled for newly owned accounts/contacts; never change the existing studio's settings",
  },
  commands: {
    "/api/v2/lessons": [
      "create",
      "update_details",
      "preview_change:cancel",
      "execute_change:cancel",
      "preview_bulk",
      "execute_bulk",
      "retry_bulk",
      "bulk_candidates",
      "bulk_progress",
      "record_history",
    ],
    "/api/v2/credits": ["set_total", "set_auto", "apply_upcoming"],
    "/api/v2/students": [
      "update:profile-only",
      "save_linked_contact:existing-owned-contact-revoke-only",
    ],
  },
  serviceOnly: [
    "confirmed synthetic Auth setup without delivery",
    "exact-ID setup of listed owned records",
    "bounded processing of this run's accepted bulk items only",
    "ordered exact-ID cleanup",
  ],
  prohibited: [
    "reschedule execute_change HTTP",
    "check_conflicts",
    "legacy cancel/reschedule wrappers",
    "portal booking changes",
    "platform health",
    "invitation/reset/OTP/claim-access",
    "provider fulfillment",
    "checkout/settlement",
    "worker invocation",
    "old executor/receipt/run",
    "automatic create retry",
  ],
  requiredBeforeAuthorization: [
    "real new immutable deployment identity",
    "exact candidate/artifact evidence",
    "separately reviewed execution driver, ownership and payload guards, durable journal",
    "fresh baseline across all 76 business tables including H01-H16 retained records",
    "independently reviewed exact-ID cleanup",
    "verified provider-free staging configuration and disabled delivery",
    "separate single-run authorization with expiry",
  ],
};
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (!process.argv[2]) throw Error("Specify proposal output path");
  writeFileSync(process.argv[2], JSON.stringify(plan, null, 2) + "\n", {
    flag: "wx",
  });
}
