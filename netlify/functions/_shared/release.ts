import { buildReleaseMetadata } from "./release.generated";
import type { ReleaseMetadata } from "./release-values";

export function releaseMetadata(): ReleaseMetadata {
  return { ...buildReleaseMetadata };
}
