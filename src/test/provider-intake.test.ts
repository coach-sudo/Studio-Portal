import { describe, expect, it } from "vitest";
import { gmailCandidate } from "../../netlify/functions/provider-intake";

describe("Gmail provider lesson parsing", () => {
  it("keeps a Lessonface wall time in the studio timezone", () => {
    const candidate = gmailCandidate(
      "Your Lessonface acting lesson is Monday, November 2, 2026 at 1:00 PM for 45 minutes.",
      { subject: "Lessonface lesson confirmed" },
      "America/New_York",
    );

    expect(candidate).toMatchObject({
      startsAt: "2026-11-02T18:00:00.000Z",
      endsAt: "2026-11-02T18:45:00.000Z",
      topic: "Lessonface lesson confirmed",
    });
  });

  it("accepts provider timestamps that already include an offset", () => {
    const candidate = gmailCandidate(
      "Confirmed 2026-08-25T13:30:00-04:00 for 60 minutes https://meet.google.com/abc-defg-hij",
      { subject: "Acuity booking" },
      "America/New_York",
    );

    expect(candidate).toMatchObject({
      startsAt: "2026-08-25T17:30:00.000Z",
      endsAt: "2026-08-25T18:30:00.000Z",
      joinUrl: "https://meet.google.com/abc-defg-hij",
      locationLabel: "Online",
    });
  });

  it("does not invent a lesson when an email has no scheduled time", () => {
    expect(
      gmailCandidate(
        "A student sent a Lessonface inquiry about acting lessons.",
        { subject: "Lessonface inquiry" },
        "America/New_York",
      ),
    ).toBeUndefined();
  });
});
