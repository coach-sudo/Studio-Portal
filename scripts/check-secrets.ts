import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const candidates = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean)
  .filter(
    (file) =>
      !file.endsWith("package-lock.json") &&
      !file.endsWith("database.generated.ts") &&
      !file.startsWith("assets/"),
  );

const patterns = [
  {
    label: "Stripe key",
    expression: /(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  },
  {
    label: "Supabase service role JWT",
    expression:
      /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
  },
  { label: "Google client secret", expression: /GOCSPX-[A-Za-z0-9_-]{20,}/g },
];

const findings: string[] = [];
for (const file of candidates) {
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const pattern of patterns) {
    pattern.expression.lastIndex = 0;
    if (pattern.expression.test(contents))
      findings.push(`${file}: ${pattern.label}`);
  }
}

if (findings.length) {
  console.error(
    `Potential committed credentials found:\n${findings.join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Secret scan passed for ${candidates.length} tracked and untracked files.`,
  );
}
