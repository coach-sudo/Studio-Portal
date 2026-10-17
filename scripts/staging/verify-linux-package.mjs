import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import console from "node:console";

// An explicit immutable SHA permits fresh local verification without replacing
// the historical default. This helper has no upload or publication capability.
const candidate = process.argv[6] || "0b18a5a2238daa49bec1290f5884d5792f4aefc9";
assert.match(candidate, /^[a-f0-9]{40}$/);
const project = "lrxrivfqjpkvygozphoz";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: "utf8" });

async function main() {
  if (process.argv[2] === "--help") {
    console.log(
      "Local packaging only; no Netlify API, deployment, database or provider calls.\nUsage: node verify-linux-package.mjs ABSOLUTE_CANDIDATE_CHECKOUT ABSOLUTE_TOOL_DIRECTORY ABSOLUTE_PUBLIC_BUILD_CONFIG ABSOLUTE_EVIDENCE_DIRECTORY\nRequires Linux x64, Node 22, a clean pinned checkout with npm ci completed, @netlify/zip-it-and-ship-it 16.0.0 and smol-toml 1.5.2 installed separately.",
    );
    return;
  }
  assert.equal(process.platform, "linux", "Windows artifacts are not accepted");
  assert.equal(process.arch, "x64");
  assert.equal(process.versions.node.split(".")[0], "22");
  const [root, tools, configFile, evidence] = process.argv
    .slice(2, 6)
    .map((p) => resolve(p));
  assert.ok(root && tools && configFile && evidence);
  assert.equal(run("git", ["rev-parse", "HEAD"], root).trim(), candidate);
  assert.equal(run("git", ["status", "--porcelain"], root).trim(), "");
  for (const [key, value] of Object.entries(process.env))
    if (
      value &&
      /^(NETLIFY_AUTH_TOKEN|SUPABASE_SERVICE_ROLE_KEY|STRIPE_|GOOGLE_|GMAIL_|E2E_FIXTURE_TOKEN|STAGING_E2E_FIXTURE_TOKEN)/.test(
        key,
      )
    )
      throw Error(
        "Deployment/service/provider credentials must not enter the packaging process",
      );
  const values = JSON.parse(
    (await readFile(configFile, "utf8")).replace(/^\uFEFF/, ""),
  );
  assert.deepEqual(Object.keys(values).sort(), [
    "VITE_QUERY_LAYER_V2",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_SUPABASE_URL",
  ]);
  assert.equal(values.VITE_SUPABASE_URL, `https://${project}.supabase.co`);
  assert.ok(["true", "false"].includes(values.VITE_QUERY_LAYER_V2));
  const keyClaims = JSON.parse(
    Buffer.from(
      values.VITE_SUPABASE_ANON_KEY.split(".")[1],
      "base64url",
    ).toString(),
  );
  assert.equal(keyClaims.role, "anon");
  assert.equal(keyClaims.ref, project);
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  const lockfile = await readFile(join(root, "package-lock.json"));
  const lockfileHash = sha256(lockfile);
  assert.equal(
    lockfileHash,
    "c1de2bdb184e932b9647d5d0648e6243ed185b58f755f377e31031c7cabaa3e9",
  );
  const build = execFileSync(
    "npm",
    ["run", "build", "--", "--logLevel", "error"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        ...values,
        COMMIT_REF: candidate,
        CONTEXT: "deploy-preview",
        NETLIFY: "true",
      },
    },
  );
  await writeFile(join(evidence, "build.log"), build, { mode: 0o600 });
  const budget = run("npm", ["run", "bundle:check"], root);
  await writeFile(join(evidence, "budget.log"), budget);
  const release = await readFile(
    join(root, "netlify/functions/_shared/release.generated.ts"),
    "utf8",
  );
  assert.ok(
    release.includes(candidate.slice(0, 12)) &&
      release.includes("deploy-preview"),
  );
  const requireTools = createRequire(join(tools, "package.json"));
  const zisiVersion = requireTools(
    "@netlify/zip-it-and-ship-it/package.json",
  ).version;
  assert.equal(zisiVersion, "16.0.0");
  const { parse } = await import(
    pathToFileURL(requireTools.resolve("smol-toml")).href
  );
  const { zipFunctions } = await import(
    pathToFileURL(requireTools.resolve("@netlify/zip-it-and-ship-it")).href
  );
  const toml = parse(await readFile(join(root, "netlify.toml"), "utf8"));
  assert.equal(toml.build.environment.NODE_VERSION, "22");
  const functionsConfig = { "*": { nodeVersion: "nodejs22.x" } };
  for (const [name, entry] of Object.entries(toml.functions || {}))
    functionsConfig[name] = {
      nodeVersion: "nodejs22.x",
      externalNodeModules: entry.external_node_modules,
      includedFiles: entry.included_files,
      includedFilesBasePath: root,
    };
  const output = join(evidence, "functions");
  await mkdir(output, { recursive: true });
  const functions = await zipFunctions(
    join(root, toml.build.functions),
    output,
    {
      basePath: root,
      repositoryRoot: root,
      config: functionsConfig,
      manifest: join(evidence, "functions-manifest.json"),
    },
  );
  const invoice = functions.find((f) => f.name === "invoice-pdf");
  assert.ok(invoice);
  assert.equal(invoice.runtimeVersion, "nodejs22.x");
  const entries = run("unzip", ["-Z1", invoice.path], root).trim().split("\n");
  assert.ok(
    entries.every(
      (entry) => !entry.startsWith("/") && !entry.split("/").includes(".."),
    ),
  );
  const binary = entries.find(
    (name) => name.includes("/@img/sharp-linux-x64/") && name.endsWith(".node"),
  );
  assert.ok(binary);
  assert.ok(
    entries.some(
      (entry) =>
        entry.includes("sharp-libvips-linux-x64/") && entry.includes("libvips"),
    ),
  );
  assert.ok(entries.includes("public/fonts/invoice-sans.ttf"));
  assert.ok(!entries.some((entry) => /sharp-win32|\.dll$|\.exe$/i.test(entry)));
  const unpacked = join(evidence, "invoice-unpacked");
  await mkdir(unpacked);
  run("unzip", ["-q", invoice.path, "-d", unpacked], root);
  const entry = entries.find((name) =>
    /netlify\/functions\/invoice-pdf\.m?js$/.test(name),
  );
  assert.ok(
    entry,
    "Bundled user module must be identified independently of the bootstrap",
  );
  const requireInvoice = createRequire(join(unpacked, entry));
  assert.ok(requireInvoice.resolve("sharp").startsWith(unpacked + "/"));
  const sharp = requireInvoice("sharp");
  const png = await sharp({
    create: { width: 32, height: 16, channels: 4, background: "#345678" },
  })
    .png()
    .toBuffer();
  assert.equal((await sharp(png).metadata()).width, 32);
  assert.equal(
    (await readFile(join(unpacked, binary))).subarray(0, 4).toString("hex"),
    "7f454c46",
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error(
      "Network is forbidden during local function import/GET verification",
    );
  };
  try {
    const handler = (await import(pathToFileURL(join(unpacked, entry)).href))
      .default;
    assert.equal(typeof handler, "function");
    const response = await handler(
      new globalThis.Request("https://packaging.invalid/api/invoice-pdf", {
        method: "GET",
      }),
    );
    assert.equal(response.status, 405);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const client = [];
  let clientText = "";
  for (const name of (await readdir(join(root, "dist/assets"))).sort()) {
    const bytes = await readFile(join(root, "dist/assets", name));
    client.push({
      file: `assets/${name}`,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
    if (name.endsWith(".js")) clientText += bytes.toString();
  }
  assert.ok(clientText.includes(values.VITE_SUPABASE_URL));
  assert.ok(
    !clientText.includes("htwthzshhilrjtqwprlo") &&
      !clientText.includes("portal.d-a-j.com"),
  );
  for (const token of clientText.matchAll(
    /eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g,
  )) {
    const claims = JSON.parse(Buffer.from(token[1], "base64url").toString());
    assert.equal(claims.ref, project);
    assert.equal(claims.role, "anon");
  }
  assert.equal(
    sha256(await readFile(join(root, "package-lock.json"))),
    lockfileHash,
  );
  assert.equal(run("git", ["status", "--porcelain"], root).trim(), "");
  const manifest = {
    candidate,
    lockfileSha256: lockfileHash,
    platform: process.platform,
    architecture: process.arch,
    node: process.version,
    zisiVersion,
    queryLayerV2: values.VITE_QUERY_LAYER_V2 === "true",
    supabaseProject: project,
    functionRuntime: "nodejs22.x",
    sharpVersion: sharp.versions.sharp,
    libvipsVersion: sharp.versions.vips,
    sharpRenderSha256: sha256(png),
    invoiceLocalImportAndGet: "405 without network access",
    client,
    functions: await Promise.all(
      functions.map(async (f) => ({
        name: f.name,
        runtime: f.runtimeVersion,
        sha256: sha256(await readFile(f.path)),
        schedule: f.schedule || null,
        routes: f.routes || [],
      })),
    ),
  };
  await writeFile(
    join(evidence, "artifact-identity.json"),
    JSON.stringify(manifest, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...manifest,
        client: `${client.length} hashed assets`,
        functions: `${manifest.functions.length} hashed bundles`,
        evidence,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
