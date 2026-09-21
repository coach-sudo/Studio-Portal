import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  coachPageSize,
  paginatedQueryKey,
  portalPageSize,
  shouldShowPagination,
} from "./pagination";
import { studioDomainQueryKey, studioQueryKey } from "../hooks/useStudio";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("route-specific query contracts", () => {
  it("includes role, student, filters, and sorted domains in cache keys", () => {
    expect(
      studioQueryKey("student", "student-1", ["work", "identity"]),
    ).toEqual(["studio-route", "student", "student-1", ["identity", "work"]]);
    expect(studioDomainQueryKey("coach", undefined, "lessons")).toEqual([
      "studio-domain",
      "coach",
      null,
      "lessons",
    ]);
    expect(
      paginatedQueryKey({
        domain: "students",
        table: "students",
        page: 2,
        pageSize: coachPageSize,
        search: { column: "full_name", value: "maya" },
        filters: { status: "active" },
        sort: { column: "full_name", ascending: true },
      }),
    ).toContain(2);
  });

  it("uses role-sized pages and hides unnecessary pagination", () => {
    expect(coachPageSize).toBe(25);
    expect(portalPageSize).toBe(10);
    expect(shouldShowPagination(25, coachPageSize)).toBe(false);
    expect(shouldShowPagination(26, coachPageSize)).toBe(true);
    expect(shouldShowPagination(0, portalPageSize)).toBe(false);
  });

  it("loads each V2 domain through the RLS-preserving RPC", () => {
    const repository = read("src/data/repository.ts");
    expect(repository).toContain('"studio_route_snapshot"');
    const migration = read(
      "supabase/migrations/20260919091000_route_snapshot_rpc.sql",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain("to authenticated");
  });

  it("declares only the domains required by focused routes", () => {
    expect(read("src/components/AppShell.tsx")).toContain('["identity"]');
    expect(read("src/features/messages/Inbox.tsx")).toContain('"messaging"');
    expect(read("src/features/referrals/Referrals.tsx")).not.toContain(
      '"finance"',
    );
  });

  it("keeps polling only in the explicitly disabled rollback branch", () => {
    const hook = read("src/hooks/useStudio.ts");
    expect(hook).toContain("queryLayerV2Enabled");
    expect(hook).toContain("refetchInterval: false as const");
    expect(hook).toContain("studio-legacy");
    expect(hook).toContain("placeholderData");
  });

  it("uses database paging on the major collection screens", () => {
    const roster = read("src/features/coach/StudentsIndex.tsx");
    const operations = [
      "src/features/coach/StudioNotes.tsx",
      "src/features/coach/StudioMaterials.tsx",
    ]
      .map(read)
      .join("\n");
    expect(roster).toContain('table: "students"');
    expect(operations).toContain('table: "notes"');
    expect(operations).toContain('table: "material_library_rows"');
    expect(operations).toContain("shouldShowPagination");
  });

  it("does not retain broad studio-cache invalidations", () => {
    for (const path of [
      "src/features/coach/StudentWorkspace.tsx",
      "src/features/coach/StudioOperations.tsx",
      "src/features/student/StudentPortal.tsx",
      "src/features/messages/Inbox.tsx",
    ]) {
      expect(read(path)).not.toContain('queryKey: ["studio"]');
    }
  });
});
