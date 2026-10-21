import { it, expect, vi } from "vitest";
import { handleAdministrationCommands } from "./administration";
const studio = "f5550000-0000-4000-8000-000000000001";
function context(path: string, visibility = "public_actor") {
  const rpc = vi.fn().mockResolvedValue({ data: { resource: { id: studio } } });
  const db = {
    rpc,
    from: (name: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { id: studio, settings: {} } }),
        maybeSingle: async () => ({
          data:
            name === "file_assets"
              ? {
                  id: "asset",
                  visibility,
                  owner_student_id: null,
                  mime_type: "image/png",
                  file_size_bytes: 30,
                }
              : null,
        }),
      };
      return chain;
    },
  };
  return {
    domain: "settings",
    db,
    requireCoach: async () => studio,
    input: {
      command: "update",
      idempotencyKey: "settings-asset-validation",
      payload: {
        settings: {
          branding: { logoStoragePath: path, logoUrl: "expiring-token" },
        },
        baseSettings: {
          branding: {
            logoStoragePath: path,
            logoUrl: "different-render-token",
          },
        },
      },
    },
  };
}
it("rejects foreign paths and private assets used as public branding", async () => {
  await expect(
    handleAdministrationCommands(context("foreign/image") as never),
  ).rejects.toThrow(/does not belong/);
  const c = context(studio + "/image", "private");
  await expect(handleAdministrationCommands(c as never)).rejects.toThrow(
    /authorized studio image/,
  );
  expect(c.db.rpc).not.toHaveBeenCalled();
});
it("validates ownership and removes transient capabilities before the atomic Settings patch", async () => {
  const c = context(studio + "/image");
  await handleAdministrationCommands(c as never);
  expect(c.db.rpc).toHaveBeenCalledOnce();
  expect(c.db.rpc.mock.calls[0][1]).toMatchObject({
    p_patch: { branding: { logoUrl: null } },
    p_base: { branding: { logoStoragePath: studio + "/image" } },
  });
  expect(JSON.stringify(c.db.rpc.mock.calls)).not.toContain("token");
});
