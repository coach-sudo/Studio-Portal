import { describe, expect, it } from "vitest";
import { buildActivityFeed } from "../domain/activityFeed";
import { demoSnapshot } from "../data/demo";

describe("activity feed", () => {
  it("shows recent booking, work, and provider activity to the coach in newest-first order", () => {
    const data = structuredClone(demoSnapshot);
    const now = new Date("2026-08-30T18:00:00-04:00").getTime();
    data.bookings[0].updatedAt = "2026-08-30T20:00:00.000Z";
    data.materials[0].updatedAt = "2026-08-30T19:00:00.000Z";
    data.integrationImports.push({ id: "import-recent", studioId: data.studioId, provider: "gmail", externalId: "message-1", detectedSource: "lessonface", status: "needs_review", confidence: 0.9, payload: { summary: "New Lessonface lesson" }, createdAt: "2026-08-30T18:00:00.000Z", updatedAt: "2026-08-30T18:00:00.000Z" });
    const feed = buildActivityFeed(data, "coach", now);
    expect(feed.slice(0, 3).map((item) => item.kind)).toEqual(["booking", "material", "import"]);
    expect(feed.every((item, index) => !index || feed[index - 1].occurredAt >= item.occurredAt)).toBe(true);
  });

  it("keeps provider verification private from student and guardian feeds", () => {
    const data = structuredClone(demoSnapshot);
    data.integrationImports.push({ id: "import-private", studioId: data.studioId, provider: "gmail", externalId: "message-2", detectedSource: "lessonface", status: "needs_review", confidence: 0.9, payload: { summary: "New Lessonface lesson" }, createdAt: "2026-08-30T18:00:00.000Z", updatedAt: "2026-08-30T18:00:00.000Z" });
    const now = new Date("2026-08-30T18:00:00-04:00").getTime();
    expect(buildActivityFeed(data, "student", now).some((item) => item.kind === "import")).toBe(false);
    expect(buildActivityFeed(data, "guardian", now).some((item) => item.kind === "import")).toBe(false);
  });

  it("expires feed items after 30 days so activity does not become permanent clutter", () => {
    const data = structuredClone(demoSnapshot);
    for (const collection of [data.bookings, data.materials, data.assignments, data.notes])
      collection.forEach((item) => { item.updatedAt = "2026-06-01T00:00:00.000Z"; });
    data.integrationImports.forEach((item) => { item.updatedAt = "2026-06-01T00:00:00.000Z"; });
    expect(buildActivityFeed(data, "coach", new Date("2026-08-30T18:00:00-04:00").getTime())).toEqual([]);
  });
});
