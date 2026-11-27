import DOMPurify from "dompurify";

export function cleanWritingHtml(html: string, preserveInlineStyles = false) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "div",
      "br",
      "h2",
      "h3",
      "h4",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "a",
      "ul",
      "ol",
      "li",
      "span",
    ],
    ALLOWED_ATTR: [
      "href",
      "target",
      "rel",
      "start",
      ...(preserveInlineStyles ? ["style"] : []),
    ],
  });
}
