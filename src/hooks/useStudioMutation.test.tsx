import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStudioMutation } from "./useStudioMutation";

describe("useStudioMutation", () => {
  it("exposes saving and saved state and prevents a duplicate submission", async () => {
    let release!: () => void;
    const operation = vi.fn(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const { result } = renderHook(() => useStudioMutation());
    let first!: Promise<void | undefined>;
    await act(async () => {
      first = result.current.run("student", operation);
      await Promise.resolve();
    });
    expect(result.current.status).toBe("saving");
    await act(async () => {
      const duplicate = await result.current.run("student", operation);
      expect(duplicate).toBeUndefined();
      release();
      await first;
    });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("saved");
  });

  it("retains a useful error state", async () => {
    const { result } = renderHook(() => useStudioMutation());
    await act(async () => {
      await expect(
        result.current.run("settings", async () => { throw new Error("Permission denied"); }),
      ).rejects.toThrow("Permission denied");
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Permission denied");
  });

  it("supports safe optimistic state, rollback, and query invalidation", async () => {
    let value = "before";
    const invalidate = vi.fn(async () => undefined);
    const { result } = renderHook(() => useStudioMutation());
    await act(async () => {
      await expect(
        result.current.run(
          "lesson",
          async () => {
            throw new Error("Conflict");
          },
          {
            optimistic: () => {
              const previous = value;
              value = "optimistic";
              return () => {
                value = previous;
              };
            },
            invalidate,
          },
        ),
      ).rejects.toThrow("Conflict");
    });
    expect(value).toBe("before");
    expect(invalidate).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.run("lesson", async () => {
        value = "saved";
      }, { invalidate });
    });
    expect(value).toBe("saved");
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
