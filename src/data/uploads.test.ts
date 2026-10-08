// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  existing: null as null | Record<string, unknown>,
  filters: [] as unknown[][],
  upload: vi.fn(),
  insert: vi.fn(),
  signed: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "coach" } } }) },
    from: () => {
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => {
          mock.filters.push(args);
          return chain;
        },
        is: (...args: unknown[]) => {
          mock.filters.push(args);
          return chain;
        },
        maybeSingle: async () => ({ data: mock.existing, error: null }),
        insert: (value: unknown) => {
          mock.insert(value);
          return chain;
        },
        single: async () => ({
          data: { id: "asset", storage_path: "uploaded" },
          error: null,
        }),
      };
      return chain;
    },
    storage: {
      from: () => ({ upload: mock.upload, createSignedUrl: mock.signed }),
    },
  },
}));
import { uploadStudioFile } from "./uploads";
const file = new File(["identical content"], "resource.txt", {
  type: "text/plain",
});
beforeEach(() => {
  mock.existing = null;
  mock.filters = [];
  mock.upload.mockReset().mockResolvedValue({ error: null });
  mock.insert.mockReset();
  mock.signed
    .mockReset()
    .mockResolvedValue({ data: { signedUrl: "https://example.test/signed" } });
});
it("reuses an authorized hash match without uploading, scoped to the exact student and visibility", async () => {
  mock.existing = {
    id: "existing",
    storage_path: "private/scoped",
    mime_type: "text/plain",
    file_size_bytes: file.size,
  };
  const result = await uploadStudioFile({
    studioId: "studio",
    studentId: "studentA",
    entityType: "material",
    file,
    visibility: "private",
  });
  expect(result.deduplicated).toBe(true);
  expect(result.id).toBe("existing");
  expect(mock.upload).not.toHaveBeenCalled();
  expect(mock.insert).not.toHaveBeenCalled();
  expect(mock.filters).toContainEqual(["studio_id", "studio"]);
  expect(mock.filters).toContainEqual(["owner_student_id", "studentA"]);
  expect(mock.filters).toContainEqual(["visibility", "private"]);
  expect(mock.filters).toContainEqual([
    "content_sha256",
    expect.stringMatching(/^[0-9a-f]{64}$/),
  ]);
});
it("keeps studio, student and private/student objects in separate immutable upload scopes", async () => {
  await uploadStudioFile({
    studioId: "studio",
    entityType: "material",
    file,
    visibility: "student",
  });
  await uploadStudioFile({
    studioId: "studio",
    studentId: "studentA",
    entityType: "material",
    file,
    visibility: "private",
  });
  const paths = mock.upload.mock.calls.map((call) => call[0]);
  expect(paths[0]).toMatch(/^studio\/studio\/student\/sha256-/);
  expect(paths[1]).toMatch(/^studio\/studentA\/private\/sha256-/);
  expect(paths[0]).not.toBe(paths[1]);
  expect(mock.upload.mock.calls.every((call) => call[2].upsert === false)).toBe(
    true,
  );
  expect(mock.insert.mock.calls[0][0].owner_student_id).toBeNull();
  expect(mock.insert.mock.calls[1][0].owner_student_id).toBe("studentA");
});
it("rejects inconsistent duplicate metadata before any storage writes", async () => {
  mock.existing = {
    id: "existing",
    storage_path: "private/scoped",
    mime_type: "text/plain",
    file_size_bytes: 999,
  };
  await expect(
    uploadStudioFile({
      studioId: "studio",
      studentId: "studentA",
      entityType: "material",
      file,
    }),
  ).rejects.toThrow("inconsistent metadata");
  expect(mock.upload).not.toHaveBeenCalled();
});
