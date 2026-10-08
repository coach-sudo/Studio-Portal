import { beforeEach, expect, it, vi } from "vitest";
import { loadMaterialActivity } from "./library";

const client = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: client }));
beforeEach(() => vi.clearAllMocks());

function query(data: unknown[], error: { message: string } | null = null) {
  const request: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of [
    "select",
    "eq",
    "in",
    "gte",
    "order",
    "limit",
    "abortSignal",
  ])
    request[method] = vi.fn(() => request);
  request.then = vi.fn((resolve) => resolve({ data, error }));
  client.from.mockReturnValue(request);
  return request;
}

it("bounds material notifications, scopes them to the student, and excludes file and written-content projections", async () => {
  const request = query([
    {
      id: "assignment",
      student_id: "student",
      lesson_id: "lesson",
      role: "library",
      status: "vaulted",
      version: 2,
      updated_at: "2026-10-08T12:00:00Z",
      instructions: "Must not be requested",
      coach_notes: "Private",
      materials: {
        title: "Lexicon",
        category: "Reference",
        owner_student_id: null,
        approval_status: "not_public",
        version: 3,
        updated_at: "2026-10-07T12:00:00Z",
        storage_path: "private",
        text_content: "Full document",
      },
    },
  ]);
  const signal = new AbortController().signal;
  const rows = await loadMaterialActivity("studio", "student", signal);
  expect(request.limit).toHaveBeenCalledWith(25);
  expect(request.eq).toHaveBeenCalledWith("materials.studio_id", "studio");
  expect(request.eq).toHaveBeenCalledWith("student_id", "student");
  expect(request.abortSignal).toHaveBeenCalledWith(signal);
  const projection = request.select.mock.calls[0][0];
  expect(projection).not.toMatch(
    /storage_path|instructions|coach_notes|text_content|\*/,
  );
  expect(rows).toEqual([
    {
      id: "assignment",
      studentId: "student",
      lessonId: "lesson",
      role: "library",
      status: "vaulted",
      title: "Lexicon",
      category: "Reference",
      approvalStatus: "not_public",
      version: 4,
      updatedAt: "2026-10-08T12:00:00.000Z",
    },
  ]);
});

it("reports an activity query error without substituting unrestricted results", async () => {
  query([], { message: "Permission denied" });
  await expect(loadMaterialActivity("studio")).rejects.toThrow(
    "Permission denied",
  );
});
