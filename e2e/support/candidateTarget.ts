import { readFileSync } from "node:fs";
import { privatePath } from "../../scripts/staging/protected-browser.mjs";
import { candidateTargetSchema } from "../../src/security/candidateAcceptance";
import { hostedAcceptance as historicalTarget } from "../../src/security/hostedAcceptance";

export function readAcceptanceTarget() {
  const file = process.env.HOSTED_CANDIDATE_MANIFEST_FILE;
  if (!file) return historicalTarget;
  if (process.env.HOSTED_CANDIDATE_READ_ONLY_APPROVED !== "true")
    throw Error(
      "Candidate hosted acceptance requires separate read-only authorization",
    );
  return candidateTargetSchema.parse(
    JSON.parse(readFileSync(privatePath(file), "utf8")),
  );
}
