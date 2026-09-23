import DOMPurify from "dompurify";
import { describe, expect, it } from "vitest";

const maliciousNotes = [
  "<p>Practice</p><script>window.__xss = true</script>",
  '<img src="x" onerror="window.__xss = true">',
  '<a href="javascript:alert(1)">Open note</a>',
  '<svg onload="window.__xss = true"><circle /></svg>',
];

describe("DOMPurify note and content rendering", () => {
  it.each(maliciousNotes)("removes executable markup from %s", (html) => {
    const sanitized = DOMPurify.sanitize(html);

    expect(sanitized).not.toMatch(
      /<script|\bonerror\s*=|\bonload\s*=|javascript:/i,
    );
  });

  it("preserves the existing safe note formatting", () => {
    expect(DOMPurify.sanitize("<p>Practice <strong>daily</strong>.</p>")).toBe(
      "<p>Practice <strong>daily</strong>.</p>",
    );
  });
});
