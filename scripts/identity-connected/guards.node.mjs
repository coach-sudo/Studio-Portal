import { test } from "node:test";
import assert from "node:assert/strict";
import { assertIdentityConnectedTarget } from "./guards.mjs";
const allowed = {
  CI: "true",
  USE_EPHEMERAL_STACK: "true",
  E2E_EPHEMERAL: "true",
  IDENTITY_CONNECTED_LOCAL: "true",
  STAGING_BASE_URL: "http://127.0.0.1:8888",
  SUPABASE_URL: "http://127.0.0.1:54321",
  DB_CONTAINER: "supabase_db_studio-portal",
  GITHUB_WORKSPACE: "/owned-ci",
};
test("only the explicit isolated loopback target is accepted", () =>
  assert.doesNotThrow(() =>
    assertIdentityConnectedTarget(allowed, "/owned-ci"),
  ));
for (const [key, value] of Object.entries({
  CI: "false",
  USE_EPHEMERAL_STACK: "false",
  E2E_EPHEMERAL: "false",
  IDENTITY_CONNECTED_LOCAL: "false",
  STAGING_BASE_URL: "https://portal.d-a-j.com",
  SUPABASE_URL: "https://hosted.supabase.co",
  DB_CONTAINER: "supabase_db_another",
  GITHUB_WORKSPACE: "/another",
}))
  test(`rejects unsafe ${key}`, () =>
    assert.throws(() =>
      assertIdentityConnectedTarget({ ...allowed, [key]: value }, "/owned-ci"),
    ));
test("a nonliteral loopback lookalike is rejected", () =>
  assert.throws(() =>
    assertIdentityConnectedTarget(
      { ...allowed, SUPABASE_URL: "http://127.0.0.1.evil.test:54321" },
      "/owned-ci",
    ),
  ));
