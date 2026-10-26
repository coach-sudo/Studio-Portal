import { expect, it } from "vitest";
import { actorEmbedUrl } from "./actorEmbed";
it.each([
  [
    "https://www.youtube.com/watch?v=scene_1",
    "https://www.youtube-nocookie.com/embed/scene_1",
  ],
  [
    "https://youtu.be/scene-1",
    "https://www.youtube-nocookie.com/embed/scene-1",
  ],
  [
    "https://www.youtube-nocookie.com/embed/scene_1",
    "https://www.youtube-nocookie.com/embed/scene_1",
  ],
  ["https://vimeo.com/12345", "https://player.vimeo.com/video/12345"],
  [
    "https://player.vimeo.com/video/12345",
    "https://player.vimeo.com/video/12345",
  ],
])("preserves an allowed embed %s", (url, expected) =>
  expect(actorEmbedUrl(url)).toBe(expected),
);
it.each([
  "https://youtube.com.evil.test/watch?v=scene",
  "https://evil.test/youtube.com",
  "https://evil.test/?vimeo.com",
  "javascript:alert('youtube.com')",
  "http://youtu.be/scene",
  "https://user:password@vimeo.com/123",
  "https://vimeo.com:8080/123",
  "https://youtube.com/watch?v=%22onload=bad",
  "https://vimeo.com/not-an-id",
])("refuses an unapproved embed %s", (url) =>
  expect(actorEmbedUrl(url)).toBeUndefined(),
);
