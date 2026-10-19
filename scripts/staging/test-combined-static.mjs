import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  approvedStaticRead,
  verifyStaticBytes,
} from "./combined-ui/static-files.mjs";
import { networkRead } from "./combined-ui/network.mjs";
import { plan } from "./combined-ui/policy.mjs";
const target = {
  ...plan.target,
  origin: `https://${plan.target.deployment}--coachd-staging.netlify.app`,
  artifactHash: "a".repeat(64),
};
for (const path of ["/manifest.webmanifest", "/coachd-mark.svg"])
  test("exact immutable static GET and byte verification: " + path, () => {
    const file = approvedStaticRead("GET", target.origin + path, target);
    assert(file);
    const bytes = Buffer.from(
      readFileSync("public" + path, "utf8").replace(/\r\n/g, "\n"),
    );
    verifyStaticBytes(file, bytes);
    assert.throws(() => verifyStaticBytes(file, Buffer.from("changed")));
    assert(networkRead("GET", target.origin + path, undefined, target, {}));
    for (const method of ["POST", "PUT", "DELETE", "HEAD"])
      assert.equal(
        approvedStaticRead(method, target.origin + path, target),
        undefined,
      );
    for (const value of [
      target.origin + path + "?anything=1",
      target.origin + path + "#fragment",
      "https://portal.d-a-j.com" + path,
      "https://coachd-staging.netlify.app" + path,
    ])
      assert.equal(approvedStaticRead("GET", value, target), undefined);
    assert.equal(
      approvedStaticRead("GET", target.origin + path, {
        ...target,
        project: "htwthzshhilrjtqwprlo",
      }),
      undefined,
    );
    assert.equal(
      approvedStaticRead("GET", target.origin + "/api/calendar-worker", target),
      undefined,
    );
  });
