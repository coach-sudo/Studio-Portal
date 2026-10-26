import DOMPurify from "dompurify";
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

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

describe("DOMPurify 3.4.17 security patch", () => {
  it("loads the exact patched ESM and CommonJS exports", () => {
    expect(DOMPurify.version).toBe("3.4.17");
    const common = createRequire(import.meta.url)("dompurify")(window);
    expect(common.version).toBe("3.4.17");
    expect(
      common.sanitize("<p>Valid <em>scene</em><script>bad()</script></p>"),
    ).toBe("<p>Valid <em>scene</em></p>");
  });
  it.each(["self", "parent", "sibling"])(
    "neutralizes nodes detached by a %s-removing hook",
    (mode) => {
      const purifier = DOMPurify(window);
      const root = document.createElement("div");
      root.innerHTML =
        '<section><img class="discard" src="data:,"><img class="payload" onerror="window.__xss=true"></section><p>Safe</p>';
      const payload = root.querySelector(".payload")!;
      purifier.addHook("afterSanitizeAttributes", (node) => {
        if (node.nodeType !== 1 || (node as Element).className !== "discard")
          return;
        const element = node as Element;
        if (mode === "parent") element.parentElement?.remove();
        else if (mode === "sibling") element.nextElementSibling?.remove();
        else element.remove();
      });
      purifier.sanitize(root, { IN_PLACE: true });
      expect(payload.getAttribute("onerror")).toBeNull();
      expect(root.textContent).toContain("Safe");
    },
  );
  it.each(["script", "style", "textarea", "title"])(
    "does not return an unsafe %s root for HTML reparsing",
    (tag) => {
      const node = document.createElement(tag);
      node.textContent = '<img src=x onerror="window.__xss=true">';
      try {
        const result = DOMPurify.sanitize(node, {
          IN_PLACE: true,
          FORBID_TAGS: [tag],
        });
        const parsed = document.createElement("div");
        parsed.innerHTML =
          typeof result === "string"
            ? result
            : (result as Element).textContent || "";
        expect(parsed.querySelector("[onerror]")).toBeNull();
      } catch (error) {
        // Refusing a force-removed IN_PLACE root is the supported safe outcome.
        expect(error).toBeInstanceOf(TypeError);
      }
    },
  );
  it("cleans template contents while retaining legitimate formatting", () => {
    const result = DOMPurify.sanitize(
      '<template><p><strong>Monologue</strong><img onerror="bad()"><script>bad()</script></p></template><p>Scene</p>',
      { WHOLE_DOCUMENT: true, RETURN_DOM: true },
    );
    const template = (result as Element).querySelector("template");
    expect(template?.content.querySelector("strong")?.textContent).toBe(
      "Monologue",
    );
    expect(template?.content.querySelector("script,[onerror]")).toBeNull();
    expect(result.textContent).toContain("Scene");
  });
  it("scrubs a template expression assembled across shadow text nodes", () => {
    const host = document.createElement("div"),
      shadow = host.attachShadow({ mode: "open" });
    shadow.append(
      document.createTextNode("$"),
      document.createElement("object"),
      document.createTextNode("{window.__xss=true}"),
    );
    DOMPurify.sanitize(host, { IN_PLACE: true, SAFE_FOR_TEMPLATES: true });
    shadow.normalize();
    expect(shadow.textContent).not.toContain("${window.__xss=true}");
  });
});
