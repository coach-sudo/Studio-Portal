import test from "node:test";
import assert from "node:assert/strict";
import { plan, runId } from "./prepare-ui-mutation-plan.mjs";
test("new UI proposal is independent, deterministic and bounded", () => {
  assert.notEqual(runId, "e2e-wave1-hosted-20261016-a");
  assert.equal(plan.status, "PROPOSAL_ONLY_NOT_AUTHORIZED");
  assert.equal(plan.target.deployment, null);
  assert.equal(plan.target.candidate, null);
  const ids = [
    ...Object.values(plan.accounts).map((a) => a.id),
    ...Object.values(plan.records),
  ];
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids)
    assert.match(id, /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(
    plan.budgets.seededLessons + plan.budgets.uiCreatedLessons,
    plan.budgets.lessonsTotal,
  );
  for (const name of [
    "cashMinor",
    "lessonPriceMinor",
    "providerCalls",
    "messagesDelivered",
    "scheduledWorkers",
  ])
    assert.equal(plan.budgets[name], 0);
  assert.equal(
    plan.accounts.coach.email.endsWith("@coachd-staging.example.test"),
    true,
  );
});
