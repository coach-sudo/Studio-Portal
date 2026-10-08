import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const manifestSchema = z.array(
  z.object({
    studioId: z.string().min(1),
    ownerStudentId: z.string().nullable(),
    visibility: z.enum(["private", "student", "public_actor"]),
    storagePath: z.string().min(1),
    localPath: z.string().min(1),
    referenceIds: z.array(z.string()).default([]),
  }),
);

/** Read-only audit of administrator-exported objects. Never writes storage or database references. */
export async function auditMaterialStorage(manifest: unknown) {
  const records = manifestSchema.parse(manifest),
    objects = new Map<
      string,
      {
        studioId: string;
        ownerStudentId: string | null;
        visibility: string;
        storagePath: string;
        sha256: string;
        bytes: number;
        referenceIds: string[];
      }
    >();
  for (const record of records) {
    const bytes = await readFile(record.localPath),
      sha256 = createHash("sha256").update(bytes).digest("hex"),
      key = JSON.stringify([
        record.studioId,
        record.ownerStudentId,
        record.visibility,
        record.storagePath,
      ]);
    const existing = objects.get(key);
    if (existing && existing.sha256 !== sha256)
      throw new Error(
        "One storage object has inconsistent exported contents; re-export before continuing.",
      );
    objects.set(key, {
      studioId: record.studioId,
      ownerStudentId: record.ownerStudentId,
      visibility: record.visibility,
      storagePath: record.storagePath,
      sha256,
      bytes: bytes.length,
      referenceIds: [
        ...new Set([...(existing?.referenceIds || []), ...record.referenceIds]),
      ],
    });
  }
  const groups = new Map<
    string,
    typeof objects extends Map<string, infer T> ? T[] : never
  >();
  for (const object of objects.values()) {
    const key = JSON.stringify([
      object.studioId,
      object.ownerStudentId,
      object.visibility,
      object.sha256,
    ]);
    groups.set(key, [...(groups.get(key) || []), object]);
  }
  const duplicateGroups = [...groups.values()].filter(
    (group) => group.length > 1,
  );
  return {
    scope: "Only objects included in this locally verified export",
    deletionAllowed: false,
    verifiedObjects: objects.size,
    verifiedBytes: [...objects.values()].reduce(
      (total, object) => total + object.bytes,
      0,
    ),
    referencedRecords: new Set(
      [...objects.values()].flatMap((object) => object.referenceIds),
    ).size,
    canonicalContentGroups: groups.size,
    confirmedDuplicateObjects: duplicateGroups.reduce(
      (total, group) => total + group.length - 1,
      0,
    ),
    duplicateBytesInManifest: duplicateGroups.reduce(
      (total, group) =>
        total + group.slice(1).reduce((sum, object) => sum + object.bytes, 0),
      0,
    ),
    duplicateGroups: duplicateGroups.map((group) => ({
      studioId: group[0].studioId,
      ownerStudentId: group[0].ownerStudentId,
      visibility: group[0].visibility,
      sha256: group[0].sha256,
      objects: group.map(({ storagePath, referenceIds }) => ({
        storagePath,
        referenceIds,
      })),
      nextStep:
        "Verify all database references, permissions and restorable backups before a separately approved consolidation.",
    })),
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const index = process.argv.indexOf("--manifest"),
    file = process.argv[index + 1];
  if (index < 0 || !file)
    throw new Error(
      "Usage: npx tsx scripts/audit-material-storage.ts --manifest <export.json>",
    );
  console.log(
    JSON.stringify(
      await auditMaterialStorage(JSON.parse(await readFile(file, "utf8"))),
      null,
      2,
    ),
  );
}
