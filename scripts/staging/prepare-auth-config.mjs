import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import console from "node:console";
import { deploymentOrigin, privatePath } from "./protected-browser.mjs";

const site = "d83ff6cb-f57b-4741-8c3c-3eaae7adab19";
const candidate = "0b18a5a2238daa49bec1290f5884d5792f4aefc9";

/** Accept only a sanitized real deploy receipt after the authorized upload. */
export function authConfiguration(receipt) {
  assert.equal(receipt.site_id, site, "Unexpected Netlify site");
  assert.equal(
    receipt.context,
    "deploy-preview",
    "Only an unpublished preview is allowed",
  );
  assert.equal(receipt.state, "ready");
  assert.equal(
    receipt.published_at,
    null,
    "Published deployments are forbidden",
  );
  assert.match(receipt.id, /^[0-9a-f]{24}$/);
  assert.notEqual(
    receipt.id,
    "6ace53e7f850061d7c49b711",
    "The old publication cannot be reused",
  );
  assert.equal(
    receipt.verified_source_sha,
    candidate,
    "Verified source/artifact identity is required",
  );
  assert.equal(receipt.verified_health?.release?.context, "deploy-preview");
  assert.equal(
    receipt.verified_health?.release?.commit,
    candidate.slice(0, 12),
  );
  if (receipt.commit_ref !== null && receipt.commit_ref !== undefined)
    assert.equal(receipt.commit_ref, candidate);
  const origin = deploymentOrigin(receipt.permalink);
  assert.equal(origin, `https://${receipt.id}--coachd-staging.netlify.app`);
  const callback = `${origin}/auth/callback`;
  // JSON string escaping also produces valid TOML double-quoted strings.
  return `project_id = "studio-portal-staging-auth"\n\n[auth]\nsite_url = ${JSON.stringify(origin)}\nadditional_redirect_urls = ${JSON.stringify([callback, `${callback}\\?**`])}\n`;
}

async function main() {
  if (!process.argv[2] || process.argv[2] === "--help") {
    console.log(
      "Preparation only: reads a sanitized, verified deployment receipt and writes a minimal external Auth config. Never pushes configuration or sends auth messages.\nUsage: node scripts/staging/prepare-auth-config.mjs ABSOLUTE_RECEIPT_PATH ABSOLUTE_PRIVATE_CONFIG_DIRECTORY\nReceipt fields: id, site_id, context, state, published_at, commit_ref, permalink, verified_source_sha, verified_health.release. Populate only from the real authorized deployment, its artifact evidence and a protected health read. No receipt or deployment ID exists yet.",
    );
    return;
  }
  const receipt = JSON.parse(
    await readFile(privatePath(process.argv[2]), "utf8"),
  );
  const directory = privatePath(process.argv[3]);
  const config = authConfiguration(receipt);
  await mkdir(join(directory, "supabase"), { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "supabase/config.toml"), config, {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    "Minimal staging Auth config prepared; existing files are never overwritten. Review with supabase config diff --project-ref lrxrivfqjpkvygozphoz --workdir PRIVATE_CONFIG_DIRECTORY. A config push requires separate authorization.",
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main().catch(() => {
    console.error(
      "Auth configuration preparation rejected; no remote operation performed.",
    );
    process.exitCode = 1;
  });
