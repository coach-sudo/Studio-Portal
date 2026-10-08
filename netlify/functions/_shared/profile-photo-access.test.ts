// @vitest-environment node
import { expect, it, vi } from "vitest";
import { requireAccessibleProfilePhoto } from "./profile-photo-access";

const image = {
  id: "photo",
  studio_id: "studio",
  owner_student_id: "student",
  mime_type: "image/png",
};
function caller(data: unknown) {
  const request = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  };
  return { from: vi.fn(() => request) } as unknown as Parameters<
    typeof requireAccessibleProfilePhoto
  >[0];
}
it("accepts an authorized image owned by the intended student", async () => {
  await expect(
    requireAccessibleProfilePhoto(caller(image), "photo", "student", "studio"),
  ).resolves.toBeUndefined();
});
it.each([
  ["unpublished or otherwise invisible asset", null],
  ["another student", { ...image, owner_student_id: "other" }],
  ["another studio", { ...image, studio_id: "other" }],
  ["non-image resource", { ...image, mime_type: "application/pdf" }],
])(
  "rejects a profile reference to %s without exposing its metadata",
  async (_name, asset) => {
    await expect(
      requireAccessibleProfilePhoto(
        caller(asset),
        "photo",
        "student",
        "studio",
      ),
    ).rejects.toThrow("Choose an accessible image");
  },
);
