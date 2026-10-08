// @vitest-environment node
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { expect, it } from "vitest";
import { auditMaterialStorage } from "./audit-material-storage";
it("confirms duplicate bytes only within an ownership and visibility scope, without deleting anything", async () => {
  const directory = await mkdtemp(join(tmpdir(), "studio-library-audit-"));
  try {
    const first = join(directory, "first.txt"),
      second = join(directory, "second.txt"),
      changed = join(directory, "version.txt");
    await writeFile(first, "original");
    await writeFile(second, "original");
    await writeFile(changed, "different version");
    const base = {
      studioId: "studio",
      ownerStudentId: null,
      visibility: "student",
      localPath: first,
      referenceIds: ["resourceA"],
    };
    const result = await auditMaterialStorage([
      { ...base, storagePath: "one" },
      {
        ...base,
        storagePath: "two",
        localPath: second,
        referenceIds: ["resourceB"],
      },
      { ...base, storagePath: "one", referenceIds: ["assignmentA"] },
      {
        ...base,
        storagePath: "private",
        ownerStudentId: "studentA",
        visibility: "private",
      },
      { ...base, storagePath: "version", localPath: changed },
    ]);
    expect(result.verifiedObjects).toBe(4);
    expect(result.confirmedDuplicateObjects).toBe(1);
    expect(result.canonicalContentGroups).toBe(3);
    expect(result.duplicateBytesInManifest).toBe(8);
    expect(result.deletionAllowed).toBe(false);
  } finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + sep))
      throw new Error("Unexpected test directory");
    await rm(directory, { recursive: true, force: true });
  }
});
