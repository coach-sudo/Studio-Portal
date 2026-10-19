import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  readFileSync,
  writeFileSync,
  realpathSync,
  statSync,
  lstatSync,
  readdirSync,
} from "node:fs";
import { resolve, relative, sep, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { sha } from "./policy.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export function restricted(path, directory = false) {
  const p = resolve(path),
    r = relative(root, p);
  assert(
    r === ".." || r.startsWith(".." + sep),
    "Private path must be outside repository",
  );
  assert.equal(realpathSync(p), p);
  assert(!lstatSync(p).isSymbolicLink());
  assert(directory ? statSync(p).isDirectory() : statSync(p).isFile());
  if (process.platform === "win32") {
    const script =
      "$p='" +
      p.replaceAll("'", "''") +
      "'; $a=Get-Acl -LiteralPath $p; $s=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; if(-not $a.AreAccessRulesProtected){exit 2}; foreach($r in $a.Access){$i=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($i -ne $s -and $i -ne 'S-1-5-18'){exit 3}}";
    execFileSync(
      "pwsh.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { stdio: "pipe" },
    );
  } else {
    assert.equal(statSync(p).uid, process.getuid());
    assert.equal(statSync(p).mode & 0o077, 0);
  }
  return p;
}
export const readPrivate = (path) =>
  JSON.parse(readFileSync(restricted(path), "utf8").replace(/^\uFEFF/, ""));
export function writePrivate(path, value) {
  restricted(dirname(resolve(path)), true);
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  if (process.platform === "win32") {
    const script =
      "$p='" +
      resolve(path).replaceAll("'", "''") +
      "'; $a=New-Object System.Security.AccessControl.FileSecurity; $a.SetAccessRuleProtection($true,$false); $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $a.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($u,'FullControl','Allow'))); $a.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow'))); Set-Acl -LiteralPath $p -AclObject $a";
    execFileSync(
      "pwsh.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { stdio: "pipe" },
    );
  }
  restricted(path);
}
// Seal canonical text so a checkout's CRLF conversion cannot change the
// reviewed executable identity. Artifact/file-byte digests remain raw hashes.
export const sourceHash = (bytes) =>
  sha(bytes.toString("utf8").replace(/\r\n/g, "\n"));
export function executorHash() {
  const directory = dirname(fileURLToPath(import.meta.url));
  const names = readdirSync(directory)
    .filter((n) => n.endsWith(".mjs"))
    .sort();
  const files = [
    ...names.map((n) => join(directory, n)),
    join(directory, "../hosted-combined-ui.mjs"),
    join(directory, "../prepare-combined-ui-plan.mjs"),
    join(directory, "../combined-schema-fingerprint.sql"),
    join(root, "docs/wave-one-hosted-business-verification.json"),
    join(directory, "../prepare-ui-mutation-plan.mjs"),
  ];
  return sha(
    files.map((f) => ({
      path: relative(root, f).replaceAll("\\", "/"),
      sha256: sourceHash(readFileSync(f)),
    })),
  );
}
