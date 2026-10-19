import { expect, it } from "vitest";
import {
  anchorLabel,
  embeddedResourceUrl,
  safeResourceUrl,
  viewerKind,
} from "./resourceViewer";
import type { ResourceDetail } from "./library";
const resource: ResourceDetail = {
  id: "one",
  title: "Study",
  description: "",
  source: "",
  keywords: [],
  text: "",
  version: 1,
  storagePath: "private/file",
};
it("uses explicit safe MIME types and never embeds uploaded HTML or SVG", () => {
  for (const [mimeType, kind] of [
    ["application/pdf", "pdf"],
    ["image/png", "image"],
    ["audio/mp4", "audio"],
    ["video/mp4", "video"],
    ["text/plain", "text-file"],
    ["text/html", "unsupported"],
    ["image/svg+xml", "unsupported"],
  ])
    expect(viewerKind({ ...resource, mimeType })).toBe(kind);
  expect(
    viewerKind({ ...resource, storagePath: undefined, text: "Readable" }),
  ).toBe("text");
});
it("only embeds supported exact provider hosts and rejects unsafe schemes, credentials and deceptive hosts", () => {
  expect(embeddedResourceUrl("https://youtu.be/abcDEF123_-")).toBe(
    "https://www.youtube-nocookie.com/embed/abcDEF123_-",
  );
  expect(embeddedResourceUrl("https://vimeo.com/12345")).toBe(
    "https://player.vimeo.com/video/12345",
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hello",
    "https://youtube.com.evil.test/watch?v=abcDEF123_-",
    "https://person:secret@youtube.com/watch?v=abcDEF123_-",
    "https://example.test/file.mp4",
    "http://vimeo.com/12345",
  ])
    expect(embeddedResourceUrl(url)).toBeNull();
  expect(safeResourceUrl("javascript:alert(1)")).toBeNull();
});
it("labels page, paragraph and playback anchors without storing file access URLs", () => {
  expect(anchorLabel({ page: 4 })).toBe("Page 4");
  expect(anchorLabel({ paragraph: 3 })).toBe("Paragraph 3");
  expect(anchorLabel({ seconds: 91 })).toBe("1:31");
});
