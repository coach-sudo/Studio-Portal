import { describe, expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), abort: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));
import { searchRecords, loadRecordTarget } from "./globalSearch";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.abort.mockReset();
});
function response(data: unknown) {
  const promise = Promise.resolve({ data, error: null });
  mocks.abort.mockReturnValue(promise);
  mocks.rpc.mockReturnValue(
    Object.assign(promise, { abortSignal: mocks.abort }),
  );
}
describe("bounded workspace read contracts", () => {
  it("does not query records below the minimum", async () => {
    expect((await searchRecords(" x ")).items).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("forwards cancellation and explicit student/group/page", async () => {
    response({ items: [], moreGroups: [], page: 2 });
    const abort = new AbortController();
    await searchRecords(" hello ", id, "lesson", 2, abort.signal);
    expect(mocks.rpc).toHaveBeenCalledWith("studio_global_search", {
      p_query: "hello",
      p_student: id,
      p_group: "lesson",
      p_page: 2,
    });
    expect(mocks.abort).toHaveBeenCalledWith(abort.signal);
  });
  it("rejects an oversized or private-shaped response", async () => {
    response({
      items: Array(31).fill({ kind: "lesson", id, title: "x", snippet: "" }),
      moreGroups: [],
      page: 1,
    });
    await expect(searchRecords("xx")).rejects.toThrow();
  });
  it("treats an unauthorized target as unavailable", async () => {
    response(null);
    expect(await loadRecordTarget("lesson", id)).toBeNull();
  });
  it("rejects invalid record identifiers before transport", async () => {
    await expect(loadRecordTarget("lesson", "not-a-uuid")).rejects.toThrow();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
