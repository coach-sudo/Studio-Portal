// New bounded acceptance identity. Historical UI run/source/ceilings stay intact.
import { createHash } from "node:crypto";
import {
  plan as historical,
  plannedUiId as oldId,
} from "./prepare-ui-mutation-plan.mjs";
export const runId = "e2e-waves12-ui-20261019-a";
export function plannedUiId(name) {
  const h = createHash("sha256")
    .update(`${runId}:${name}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  h[12] = "4";
  h[16] = "a";
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    h.slice(12, 16),
    h.slice(16, 20),
    h.slice(20),
  ]
    .map((x) => x.join(""))
    .join("-");
}
const names = [
  ...Object.keys(historical.records),
  ...Object.keys(historical.accounts).map((k) => "auth-" + k),
  ...["coach", "student", "guardian"].map((k) => "membership-" + k),
];
const map = new Map(names.map((n) => [oldId(n), plannedUiId(n)]));
const clone = (value) =>
  typeof value === "string"
    ? map.get(value) || value.replaceAll(historical.runId, runId)
    : Array.isArray(value)
      ? value.map(clone)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, clone(v)]),
          )
        : value;
export const plan = clone(historical);
plan.status = "AUTHORIZED_SCOPE_PENDING_FRESH_RECEIPT";
plan.target.deployment = "6ad59afc32390ffd00c5d20e";
plan.target.candidate = "36f446392dd940ad25b0ba7449b7dad8d938c636";
for (const n of [
  "other-contact",
  "note-published",
  "note-draft",
  "material-private",
  "material-link",
  "unavailable",
])
  plan.records[n] = plannedUiId(n);
Object.assign(plan.budgets, {
  contacts: 2,
  relationships: 2,
  seededLessons: 12,
  uiCreatedLessons: 0,
  readRequests: 1200,
  browserReadCeiling: 1100,
  notes: 2,
  materials: 1,
  materialLinks: 1,
});
plan.fixtureContent.lessons.find((l) => l.name === "lesson-edit").startsAt =
  "2026-10-19T18:00:00Z";
plan.fixtureContent.lessons.find((l) => l.name === "lesson-edit").endsAt =
  "2026-10-19T19:00:00Z";
plan.cases = ["UI05", "UI06", "UI07", "UI08", "WAVE2"];
plan.commands["/api/v2/lessons"] = plan.commands["/api/v2/lessons"].filter(
  (x) => x !== "create",
);
plan.budgetRationale = {
  readRequests:
    "1200 total hard attempts, fixed before any hosted receipt. The full two-engine local rehearsal measured 1036 including deliberately interrupted cleanup and guard probes. Allow 120 for live perimeter/metadata/Auth attestation and 44 margin. Browser requests stop at 1100 (one denied attempt remains charged), leaving at least 99 reads for cleanup, whose measured local tail used 48. No snapshot polling loop; original 600-read authority remains exhausted and unchanged.",
  httpMutationRequests:
    "30 total: at most 24 business submissions plus six fixed session operations. No automatically retried sign-in or business command.",
  canonicalSqlRequests:
    "60 includes setup, four owned batch processors and exact canonical cleanup; no global workers.",
  cleanupTransactions:
    "40 ceiling; expected ten exact-ID transactions; retained authored/financial/audit history is never deleted.",
};
