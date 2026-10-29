import assert from "node:assert/strict";
export function assertIdentityConnectedTarget(env, cwd) {
  assert.equal(env.CI, "true", "Connected acceptance is CI-only");
  assert.equal(env.USE_EPHEMERAL_STACK, "true");
  assert.equal(env.E2E_EPHEMERAL, "true");
  assert.equal(env.IDENTITY_CONNECTED_LOCAL, "true");
  assert.equal(env.STAGING_BASE_URL, "http://127.0.0.1:8888");
  assert.equal(env.SUPABASE_URL, "http://127.0.0.1:54321");
  assert.equal(env.DB_CONTAINER, "supabase_db_studio-portal");
  assert.equal(
    env.GITHUB_WORKSPACE,
    cwd,
    "Only the calling CI workspace owns this local stack",
  );
}
