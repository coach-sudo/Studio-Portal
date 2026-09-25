export interface ReleaseMetadata {
  commit: string;
  context: string;
}

interface BuildEnvironment {
  COMMIT_REF?: string;
  CONTEXT?: string;
  GITHUB_SHA?: string;
  NETLIFY?: string;
}

const fullSha = /^[0-9a-f]{40}$/i;

export function resolveBuildReleaseMetadata(
  environment: BuildEnvironment,
): ReleaseMetadata {
  const commit = environment.COMMIT_REF || environment.GITHUB_SHA || "";
  const context = environment.CONTEXT || "";
  if (
    (environment.NETLIFY === "true" || Boolean(environment.COMMIT_REF)) &&
    (!fullSha.test(commit) || !context)
  ) {
    throw new Error(
      "Netlify build is missing valid commit or deploy context metadata.",
    );
  }
  if (context === "production" && !fullSha.test(commit)) {
    throw new Error("Production build requires a full Git commit SHA.");
  }
  return {
    commit: fullSha.test(commit) ? commit.slice(0, 12).toLowerCase() : "local",
    context: context || "local",
  };
}
