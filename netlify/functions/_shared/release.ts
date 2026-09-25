export interface ReleaseMetadata {
  commit: string;
  context: string;
}

export function releaseMetadata(): ReleaseMetadata {
  const environment =
    typeof Netlify === "undefined"
      ? process.env
      : {
          COMMIT_REF: Netlify.env.get("COMMIT_REF"),
          CONTEXT: Netlify.env.get("CONTEXT"),
        };
  const commit = environment.COMMIT_REF || "local";
  return {
    commit: commit === "local" ? commit : commit.slice(0, 12),
    context: environment.CONTEXT || "local",
  };
}
