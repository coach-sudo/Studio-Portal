import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveBuildReleaseMetadata } from "../netlify/functions/_shared/release-values";

const metadata = resolveBuildReleaseMetadata(process.env);
const target = join(
  process.cwd(),
  "netlify",
  "functions",
  "_shared",
  "release.generated.ts",
);
await writeFile(
  target,
  `// Generated at build time from non-secret Git/deploy metadata. Do not edit.\nexport const buildReleaseMetadata = ${JSON.stringify(metadata)} as const;\n`,
);
console.log(
  `Release metadata prepared for ${metadata.context} (${metadata.commit}).`,
);
