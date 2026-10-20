import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { configure } from "@testing-library/dom";
import { afterEach, beforeEach, vi } from "vitest";
// Lazy feature compilation can exceed the library's 1-second default on CI/Windows.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  if (typeof window !== "undefined") window.localStorage.clear();
});

beforeEach(() => {
  if (typeof window !== "undefined") window.scrollTo = vi.fn();
});
