import { describe, expect, it } from "vitest";
import { resolveBuildReleaseMetadata } from "../../netlify/functions/_shared/release-values";

const commit = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";

describe("build-to-runtime release metadata", () => {
  it("identifies an unconfigured local build explicitly", () => {
    expect(resolveBuildReleaseMetadata({})).toEqual({
      commit: "local",
      context: "local",
    });
  });

  it("embeds a shortened, normalized production commit and context", () => {
    expect(
      resolveBuildReleaseMetadata({
        COMMIT_REF: commit,
        CONTEXT: "production",
        NETLIFY: "true",
      }),
    ).toEqual({ commit: "abcdef012345", context: "production" });
  });

  it("preserves the deploy-preview context and commit", () => {
    expect(
      resolveBuildReleaseMetadata({
        COMMIT_REF: commit,
        CONTEXT: "deploy-preview",
        NETLIFY: "true",
      }),
    ).toEqual({ commit: "abcdef012345", context: "deploy-preview" });
  });

  it("refuses incomplete Netlify or production metadata", () => {
    expect(() => resolveBuildReleaseMetadata({ NETLIFY: "true" })).toThrow();
    expect(() => resolveBuildReleaseMetadata({ COMMIT_REF: commit })).toThrow();
    expect(() =>
      resolveBuildReleaseMetadata({
        COMMIT_REF: "not-a-sha",
        CONTEXT: "production",
      }),
    ).toThrow();
  });
});
