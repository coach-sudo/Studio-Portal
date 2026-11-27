import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { configure } from "@testing-library/dom";
import { afterEach, beforeEach, vi } from "vitest";
// Lazy feature compilation can exceed the library's 1-second default on CI/Windows.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no layout engine. Editor transactions may still ask for the caret rectangle.
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
}

afterEach(() => {
  cleanup();
  if (typeof window !== "undefined") window.localStorage.clear();
});

beforeEach(() => {
  if (typeof window !== "undefined") window.scrollTo = vi.fn();
});
