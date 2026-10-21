import { describe, it, expect } from "vitest";
import {
  settingsWriteValues,
  validateStudioImage,
} from "../domain/settingsAssets";
import { settingsPatch } from "../domain/settingsPatch";

describe("durable Settings assets", () => {
  it("round-trips removals through HTTP JSON and preserves unchanged nested values", () => {
    const base = {
      branding: {
        logoStoragePath: "studio/logo",
        logoUrl: "old-token",
        primaryColor: "#123456",
      },
    };
    const updates = {
      branding: {
        ...base.branding,
        logoStoragePath: undefined,
        logoUrl: undefined,
      },
    };
    const wire = JSON.parse(JSON.stringify(settingsWriteValues(updates)));
    expect(settingsPatch(base, wire)).toEqual({
      branding: { logoStoragePath: null, logoUrl: null },
    });
  });
  it("never persists resolved capabilities or uses them for concurrent-edit comparisons", () => {
    const resolved = {
      branding: {
        logoStoragePath: "studio/logo",
        logoUrl: "new-token",
        coachProfilePhotoStoragePath: "studio/private",
        coachProfilePhotoUrl: "private-token",
      },
      dailyPopup: {
        backgroundImageStoragePath: "studio/popup",
        backgroundImageUrl: "popup-token",
      },
    };
    expect(JSON.stringify(settingsWriteValues(resolved))).not.toContain(
      "token",
    );
    const base = settingsWriteValues(resolved, true);
    expect(base.branding).not.toHaveProperty("logoUrl");
    expect(base.branding.logoStoragePath).toBe("studio/logo");
    expect(resolved.branding.logoUrl).toBe("new-token");
  });
  it("retains explicitly configured external images without storage references", () => {
    expect(
      settingsWriteValues({
        dailyPopup: { backgroundImageUrl: "https://example.test/image.png" },
      }).dailyPopup.backgroundImageUrl,
    ).toContain("https://");
  });
  it("rejects executable, empty and oversized images before uploading", () => {
    for (const file of [
      new File(["svg"], "unsafe.svg", { type: "image/svg+xml" }),
      new File([], "empty.png", { type: "image/png" }),
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", {
        type: "image/png",
      }),
    ])
      expect(() => validateStudioImage(file)).toThrow(/PNG, JPEG or WebP/);
    expect(() =>
      validateStudioImage(new File(["png"], "logo.png", { type: "image/png" })),
    ).not.toThrow();
  });
});
