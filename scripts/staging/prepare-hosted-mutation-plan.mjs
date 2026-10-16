// Offline preparation only. Deliberately has no network or credential dependency.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import process from "node:process";
import console from "node:console";
import { privatePath } from "./protected-browser.mjs";

export const runId = "e2e-wave1-hosted-20261016-a";
export function plannedId(label) {
  const h = createHash("sha256").update(`${runId}:${label}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const labels = [
  "coach",
  "student-user",
  "guardian",
  "unrelated",
  "student",
  "other-student",
  "guardian-contact",
  "package-definition",
  "package",
  "grant",
  "lesson-credit",
  "lesson-return",
  "lesson-reuse",
  "lesson-paid",
  "lesson-pending-invoice",
  "lesson-provider",
  "lesson-delete",
  "lesson-protected-note",
  "lesson-archive",
  "lesson-void",
  "series",
  "series-first",
  "series-next",
  "shared-booking",
  "shared-prepaid",
  "class",
  "class-participant",
  "invoice",
  "note",
];
export const plan = {
  status: "PREPARATION_ONLY_NOT_AUTHORIZED",
  target: {
    site: "d83ff6cb-f57b-4741-8c3c-3eaae7adab19",
    project: "lrxrivfqjpkvygozphoz",
    studio: "4ceff683-e72f-4b2e-96ce-85db2dca4eb2",
    origin: "https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app",
    application: "0b18a5a2238daa49bec1290f5884d5792f4aefc9",
  },
  runId,
  ids: Object.fromEntries(labels.map((label) => [label, plannedId(label)])),
  limits: {
    newAuthUsers: 4,
    newStudents: 2,
    seededLessons: 13,
    commandCreatedLessonsMaximum: 6,
    packageLotsMaximum: 3,
    creditGrantMaximum: 12,
    syntheticCashMinorMaximum: 10000,
    currencies: ["USD"],
    bulkReviewMaximum: 20,
    commandRequestsMaximum: 100,
    liveProviderCalls: 0,
    workerInvocations: 0,
    messagesSent: 0,
  },
  cases: [
    [
      "H01",
      "Grant 4 credits; repeat identical key",
      "Exactly one grant receipt; four credits, no duplicate lot or audit",
    ],
    [
      "H02",
      "Enable auto and create 3 unpaid native lessons",
      "Three distinct reservations, remaining 4, reserved 3, available 1",
    ],
    [
      "H03",
      "Repeat apply command and recover after dropped response",
      "Applied 0, alreadyCovered 3; ledger and grant remain unchanged",
    ],
    [
      "H04",
      "Complete covered occurrence twice",
      "Exactly one consumption; no extra debit",
    ],
    [
      "H05",
      "Cancel return occurrence then check next uncovered lesson",
      "One reversal and one replacement reservation; unrelated holds unchanged",
    ],
    [
      "H06",
      "Reschedule within validity and beyond expiry",
      "Valid hold preserved; invalid hold handled by authoritative preview; no guessed settlement",
    ],
    [
      "H07",
      "Convert native lesson into three occurrences",
      "New eligible occurrences evaluated immediately; existing reservation untouched",
    ],
    [
      "H08",
      "Cancel one of two shared-booking occurrences",
      "Sibling and booking active; only selected reminder/projection intents change",
    ],
    [
      "H09",
      "Review ambiguous shared prepaid and student-scoped class cancellation",
      "Both blocked, exact review reason, payment and participation unchanged",
    ],
    [
      "H10",
      "Review protected invoice/provider/notes records alongside eligible mistake",
      "Frozen review contains exact blocked dependencies; no provider calls",
    ],
    [
      "H11",
      "Execute mixed permanent-delete job twice",
      "Mistake physically absent; authored and financial records remain; one immutable deletion snapshot",
    ],
    [
      "H12",
      "Archive, restore, void cancelled erroneous occurrence",
      "Student history and dependencies retained; lifecycle and notifications unchanged by archive/void",
    ],
    [
      "H13",
      "Change a selected lesson after preview then execute",
      "Changed item conflicted; successful sibling not repeated",
    ],
    [
      "H14",
      "Expire/retry a failed item using reviewed lease RPCs",
      "Only failed item retries; obsolete claim rejected; no scheduled worker invoked",
    ],
    [
      "H15",
      "Revoke only the new guardian, read with old session, restore",
      "Existing guardian untouched; immediate RLS denial for new guardian, then authorized reads restored",
    ],
    [
      "H16",
      "Select across pages/exclusions and refresh result route",
      "Exact frozen IDs, stable keys, no new matches; review itself treated as a write",
    ],
  ].map(([id, action, expected]) => ({ id, action, expected })),
  executionGates: [
    "Separate written authorization for this exact manifest and limits, fixture provisioning and ordered cleanup",
    "Dedicated reviewed seed/cleanup executor: do not run the broad old fixture suite or its unrelated operational journeys",
    "Read-back of exact immutable ready/unpublished preview, all-deploy protection, stopped builds and absent provider credentials",
    "Snapshot all pre-existing business rows and operational queues; require no existing-account writes",
    "New confirmed synthetic identities created through Auth administration without sending email; passwords restricted locally",
    "No calendar connection, external IDs, real recipient, real payment method, file upload or OAuth",
    "Outbox/calendar side-effect intents may be recorded but delivery and all scheduler/provider execution remain disabled",
    "Use explicit service-only per-item job processing RPCs if authorized; no public worker or maintenance invocation",
    "Abort on unlisted ID, changed baseline, unexpected provider intent, transport identity mismatch or exhausted budget",
  ],
  cleanup: [
    "Stop the runner; preserve private run journal and before/after fingerprints; never blindly replay uncertain commands",
    "Record all command receipts/results and retained deletion/audit evidence, suppress only run-owned undelivered intents",
    "Delete run-owned messages, material links, authored note fixture, invoice/settlement fixtures and financial fixture rows in FK order using separately approved privileged cleanup",
    "Remove run-owned participants, projections, lessons and bookings; preserve tombstones/deletion snapshots and append-only audit when backend requires retention",
    "Use narrow reviewed credit/lesson fixture cleanup APIs after all dependencies are gone; keep terminal run-owned students if retained audit requires them",
    "Remove only newly created memberships/relationships/contacts and four run-owned Auth identities; never reset existing accounts",
    "Prove all pre-existing row hashes equal baseline; list every intentionally retained audit/receipt/tombstone row; zero deliverable run-owned outbox/projection work",
    "Partial cleanup failure: quarantine the run, report remaining IDs and stop; no global reset, financial reversal, schema change or unscoped delete",
  ],
  remainingLimit:
    "Hosted executor and cleanup require a reviewed implementation and exact authorization before execution; provider and scheduled cadence acceptance stay excluded. Failure injection that requires schema/trigger changes remains disposable-only.",
};

if (process.argv[1]?.endsWith("prepare-hosted-mutation-plan.mjs")) {
  const output = privatePath(process.argv[2]);
  writeFileSync(output, JSON.stringify(plan, null, 2) + "\n", { mode: 0o600 });
  console.log(
    `Offline preparation: ${plan.cases.length} proposed cases; no infrastructure request made`,
  );
}
