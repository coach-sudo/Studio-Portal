import test from "node:test";
import assert from "node:assert/strict";
import { authConfiguration } from "./prepare-auth-config.mjs";

// Offline fixture only. This is never represented as a returned deployment ID.
const id = "0123456789abcdef01234567";
const receipt = {
  id,
  site_id: "d83ff6cb-f57b-4741-8c3c-3eaae7adab19",
  context: "deploy-preview",
  state: "ready",
  published_at: null,
  commit_ref: null,
  permalink: `https://${id}--coachd-staging.netlify.app`,
  verified_source_sha: "0b18a5a2238daa49bec1290f5884d5792f4aefc9",
  verified_health: {
    release: { context: "deploy-preview", commit: "0b18a5a2238d" },
  },
};
test("config grants only the exact origin/callback and escaped query suffix", () => {
  const config = authConfiguration(receipt);
  assert.match(config, /\[auth\]\nsite_url = /);
  assert.ok(config.includes(`site_url = "${receipt.permalink}"`));
  const redirects = JSON.parse(
    config.split("additional_redirect_urls = ")[1].trim(),
  );
  assert.deepEqual(redirects, [
    `${receipt.permalink}/auth/callback`,
    `${receipt.permalink}/auth/callback\\?**`,
  ]);
  assert.equal((config.match(/^\w+\s*=/gm) || []).length, 3); // project_id plus two declared Auth fields
  assert.ok(
    !config.includes("localhost") && !config.includes("portal.d-a-j.com"),
  );
});
test("rejects wrong site, publication, mutable origin and unverified candidate", () => {
  for (const change of [
    { site_id: "93829451-dbcf-4863-a07f-fa448cb17494" },
    { context: "production" },
    { context: "branch-deploy" },
    { state: "uploading" },
    { published_at: "2026-10-16T14:00:00Z" },
    { published_at: undefined },
    { permalink: "https://coachd-staging.netlify.app" },
    { permalink: `https://${id}--studio-portal.netlify.app` },
    { id: "aaaaaaaaaaaaaaaaaaaaaaaa" },
    { verified_source_sha: "65ef33366fef8025a9d62671524801b8510fa1d7" },
    { commit_ref: "fe63c57e928bca78c23e43877480b36a2d8e26c6" },
    {
      verified_health: {
        release: { context: "production", commit: "0b18a5a2238d" },
      },
    },
  ])
    assert.throws(() => authConfiguration({ ...receipt, ...change }));
});
