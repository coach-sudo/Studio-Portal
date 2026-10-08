import { expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  user: "coach" as string | null,
  authorized: true,
  sign: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  isSupabaseConfigured: true,
  isDemoMode: false,
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: mock.user ? { user: { id: mock.user } } : null },
      }),
    },
    storage: { from: () => ({ createSignedUrls: mock.sign }) },
  },
}));
import { getSignedMaterialUrl } from "./repository";
it("never reuses another account's signed download link and requests a short expiry", async () => {
  mock.sign.mockImplementation(async (paths: string[]) => ({
    data: mock.authorized
      ? paths.map((path) => ({
          path,
          signedUrl: `https://example.test/${mock.user}/${path}`,
        }))
      : [],
  }));
  expect(await getSignedMaterialUrl("shared/reference")).toContain("/coach/");
  await getSignedMaterialUrl("shared/reference");
  expect(mock.sign).toHaveBeenCalledTimes(1);
  expect(mock.sign).toHaveBeenCalledWith(["shared/reference"], 300);
  mock.user = "student";
  mock.authorized = false;
  await expect(getSignedMaterialUrl("shared/reference")).rejects.toThrow(
    "could not be opened",
  );
  expect(mock.sign).toHaveBeenCalledTimes(2);
  mock.authorized = true;
  expect(await getSignedMaterialUrl("shared/reference")).toContain("/student/");
  expect(mock.sign).toHaveBeenCalledTimes(3);
  mock.user = null;
  await expect(getSignedMaterialUrl("shared/reference")).rejects.toThrow(
    "could not be opened",
  );
  expect(mock.sign).toHaveBeenCalledTimes(3);
});
