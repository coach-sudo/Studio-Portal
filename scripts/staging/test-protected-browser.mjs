import test from "node:test";
import assert from "node:assert/strict";
import {
  deploymentOrigin,
  perimeterState,
  privatePath,
} from "./protected-browser.mjs";
import { resolve } from "node:path";
import { URL } from "node:url";

const origin = "https://0123456789abcdef01234567--coachd-staging.netlify.app";
test("only an immutable URL on the named staging site is accepted", () => {
  assert.equal(deploymentOrigin(origin), origin);
  for (const invalid of [
    "https://portal.d-a-j.com",
    "https://coachd-staging.netlify.app",
    "https://deploy-preview-45--coachd-staging.netlify.app",
    "https://0123456789abcdef01234567--studio-portal.netlify.app",
    `${origin}.attacker.test`,
    `${origin}/login`,
    `${origin}?secret=value`,
    origin.replace("https:", "http:"),
    origin.replace("https://", "https://user:password@"),
  ])
    assert.throws(() => deploymentOrigin(invalid));
});
test("private auth material cannot be saved into this checkout", () => {
  assert.throws(() => privatePath("playwright/.auth/perimeter.json"));
  assert.throws(() => privatePath(resolve("playwright/.auth/perimeter.json")));
  assert.throws(() => privatePath(resolve("..looks-private/perimeter.json")));
});
test("only secure, unexpired exact-host perimeter cookies survive", () => {
  const host = new URL(origin).hostname;
  const cookie = {
    name: "protection",
    value: "synthetic",
    domain: host,
    path: "/",
    secure: true,
    expires: 1000,
  };
  const state = perimeterState(
    {
      cookies: [
        cookie,
        { ...cookie, domain: ".netlify.app" },
        { ...cookie, domain: "app.netlify.com" },
        { ...cookie, expires: 101 },
        { ...cookie, secure: false },
      ],
      origins: [
        { origin, localStorage: [{ name: "session", value: "synthetic" }] },
      ],
    },
    origin,
    100,
  );
  assert.deepEqual(state, { cookies: [cookie], origins: [] });
});
test("missing or expired perimeter authentication fails closed", () => {
  assert.throws(() => perimeterState({ cookies: [] }, origin));
  assert.throws(() =>
    perimeterState(
      {
        cookies: [
          { domain: new URL(origin).hostname, secure: true, expires: 1 },
        ],
      },
      origin,
    ),
  );
});
