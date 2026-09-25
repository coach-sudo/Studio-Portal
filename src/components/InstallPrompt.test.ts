import { describe, expect, it } from "vitest";
import { isPwaPromptRoute, recordEligiblePwaSession } from "./InstallPrompt";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("install prompt eligibility", () => {
  it("counts only once in an authenticated browser session", () => {
    const persistent = memoryStorage();
    const session = memoryStorage();
    expect(recordEligiblePwaSession(persistent, session)).toBe(1);
    expect(recordEligiblePwaSession(persistent, session)).toBe(1);
    expect(recordEligiblePwaSession(persistent, memoryStorage())).toBe(2);
  });

  it("suppresses transactional and unauthenticated routes", () => {
    expect(isPwaPromptRoute("/portal/settings")).toBe(true);
    expect(isPwaPromptRoute("/coach/students")).toBe(true);
    expect(isPwaPromptRoute("/book")).toBe(false);
    expect(isPwaPromptRoute("/gift/package-1")).toBe(false);
    expect(isPwaPromptRoute("/portal/payments")).toBe(false);
    expect(isPwaPromptRoute("/login")).toBe(false);
  });
});
