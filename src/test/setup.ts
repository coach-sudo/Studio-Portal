import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

afterEach(() => {
  cleanup();
  if (typeof window !== "undefined") window.localStorage.clear();
});

beforeEach(() => {
  if (typeof window !== "undefined") window.scrollTo = vi.fn();
});
