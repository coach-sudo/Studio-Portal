import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { binding, plan } from "./policy.mjs";
// Actual Linux artifact bytes for application 36f446392dd9. No provider/file bodies.
const files = Object.freeze({
  "/manifest.webmanifest": {
    file: "manifest.webmanifest",
    sha256: "bbee88c1ad9f6d3f2c27897d39c87364d0709457f0018105aabd7f699e1be2cf",
  },
  "/coachd-mark.svg": {
    file: "coachd-mark.svg",
    sha256: "3e546120776d6d770adc8646fab144b60a319711805b55007080c3d17a5fda86",
  },
});
export function approvedStaticRead(method, value, target) {
  const u = new URL(value);
  if (
    method !== "GET" ||
    u.origin !== target.origin ||
    u.search ||
    u.hash ||
    u.username ||
    u.password ||
    u.port ||
    target.origin !==
      `https://${plan.target.deployment}--coachd-staging.netlify.app`
  )
    return undefined;
  try {
    binding(target);
  } catch {
    return undefined;
  }
  return files[u.pathname];
}
export function verifyStaticBytes(file, bytes) {
  assert(
    Object.values(files).some(
      (x) => x.file === file.file && x.sha256 === file.sha256,
    ),
  );
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    file.sha256,
    "Immutable public static artifact mismatch",
  );
}
