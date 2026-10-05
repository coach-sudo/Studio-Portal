import { describe, expect, it } from "vitest";
import { patchNetlifyDevApiResponses } from "./netlify-dev-api-patch";

describe("isolated Netlify CLI API response guard", () => {
  const original =
    "const alternativePathsFor = function (url) { if (isFunction(true, url)) { return []; } return ['html']; };";
  it("excludes API paths from static retry without changing the function handler", () => {
    expect(patchNetlifyDevApiResponses(original)).toContain(
      "url.startsWith('/api/')",
    );
  });
  it("preserves all existing static fallback code", () => {
    expect(patchNetlifyDevApiResponses(original)).toContain("return ['html'];");
  });
  it("is idempotent", () => {
    const once = patchNetlifyDevApiResponses(original);
    expect(patchNetlifyDevApiResponses(once)).toBe(once);
  });
  it("fails closed if the pinned runtime changes", () => {
    expect(() => patchNetlifyDevApiResponses("unknown proxy code")).toThrow(
      "Unsupported",
    );
  });
});
