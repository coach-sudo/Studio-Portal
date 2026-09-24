import { describe, expect, it } from "vitest";
import { demoSnapshot } from "../../data/demo";
import type { StudioDomain } from "../../data/repository";
import { recentLessonDuration } from "../../domain/packageSelection";
import { mergeStudioDomains } from "../../hooks/useStudio";
import { portalDomains } from "../student/StudentPortal.shared";
import { portalInvitationDelivery } from "./StudentWorkspace.shared";
import { studioRecoverySummary } from "./StudioSettings";
import {
  bookingCenterDomains,
  coachSectionDomains,
  studentWorkspaceDomains,
} from "./routeDomains";

function selectedData(domains: readonly StudioDomain[]) {
  const snapshots = domains.map((domain) => {
    const snapshot = structuredClone(demoSnapshot);
    snapshot.lessons = domain === "lessons" ? snapshot.lessons : [];
    snapshot.materials = domain === "work" ? snapshot.materials : [];
    snapshot.notes = domain === "work" ? snapshot.notes : [];
    snapshot.assignments = domain === "work" ? snapshot.assignments : [];
    snapshot.creditEntries = domain === "finance" ? snapshot.creditEntries : [];
    snapshot.packages = domain === "finance" ? snapshot.packages : [];
    snapshot.payments = domain === "finance" ? snapshot.payments : [];
    snapshot.bookingServices =
      domain === "booking" ? snapshot.bookingServices : [];
    snapshot.actorProfiles =
      domain === "actorProfiles" ? snapshot.actorProfiles : [];
    snapshot.outbox =
      domain === "messaging"
        ? [
            {
              id: "e2e-invite",
              version: 1,
              updatedAt: "2026-09-24T12:00:00Z",
              studentId: "student-maya",
              channel: "email" as const,
              recipient: "guardian@example.com",
              subject: "Portal login invitation",
              body: "Fixture invitation",
              status: "sent" as const,
              attempts: 1,
            },
          ]
        : [];
    return snapshot;
  });
  return mergeStudioDomains(domains, snapshots);
}

describe("V2 route data contracts", () => {
  it("loads booking services on Coach Finance for package building", () => {
    const domains = coachSectionDomains("finance", true);
    expect(domains).toContain("booking");
    expect(selectedData(domains)?.bookingServices.length).toBeGreaterThan(0);
  });

  it("loads lesson work and credits on Coach Lessons", () => {
    const domains = coachSectionDomains("lessons", true);
    expect(domains).toEqual(expect.arrayContaining(["work", "finance"]));
    expect(selectedData(domains)?.materials.length).toBeGreaterThan(0);
    expect(selectedData(domains)?.creditEntries.length).toBeGreaterThan(0);
  });

  it("loads the messaging outbox and accurate recovery counts on Coach Settings", () => {
    const domains = coachSectionDomains("settings", true);
    expect(domains).toEqual(
      expect.arrayContaining(["students", "messaging", "work", "lessons"]),
    );
    const data = selectedData(domains)!;
    expect(data.outbox[0]?.status).toBe("sent");
    expect(studioRecoverySummary(data)).toBe(
      `${data.students.length} people · ${demoSnapshot.lessons.length} lessons · ${demoSnapshot.materials.length} materials.`,
    );
  });

  it("loads pending actor reviews on Coach Today", () => {
    const domains = coachSectionDomains("today", true);
    expect(domains).toEqual(
      expect.arrayContaining(["actorProfiles", "booking"]),
    );
    expect(selectedData(domains)?.actorProfiles.length).toBeGreaterThan(0);
  });

  it("loads lesson work and credits only on the booking calendar tab", () => {
    expect(bookingCenterDomains("calendar")).toEqual(
      expect.arrayContaining(["lessons", "work", "finance"]),
    );
    expect(bookingCenterDomains("services")).not.toContain("work");
    expect(bookingCenterDomains("services")).not.toContain("finance");
  });

  it("loads invitation delivery for Account and contact profiles, not every student tab", () => {
    for (const path of [
      "/coach/students/student-maya/account",
      "/coach/students/student-maya/contacts/contact-dana",
    ]) {
      const domains = studentWorkspaceDomains(path);
      expect(domains).toEqual(expect.arrayContaining(["messaging", "booking"]));
      expect(
        portalInvitationDelivery(
          selectedData(domains)!,
          "student-maya",
          "GUARDIAN@example.com",
        )?.status,
      ).toBe("sent");
    }
    expect(
      studentWorkspaceDomains("/coach/students/student-maya/work"),
    ).not.toContain("messaging");
    expect(
      studentWorkspaceDomains("/coach/students/student-maya/actor-page"),
    ).toContain("actorProfiles");
  });

  it("matches the actual portal schedule and home routes", () => {
    expect(portalDomains("/portal/bookings")).toContain("booking");
    expect(portalDomains("/portal")).toContain("finance");
    expect(portalDomains("/portal/work")).not.toContain("finance");
    expect(portalDomains("/portal/schedule")).not.toContain("booking");
  });

  it("loads lesson history for Payments recommendations and Work lesson links", () => {
    for (const path of ["/portal/payments", "/portal/work"]) {
      const domains = portalDomains(path);
      expect(domains).toContain("lessons");
      expect(selectedData(domains)?.lessons.length).toBeGreaterThan(0);
    }
    const paymentsData = selectedData(portalDomains("/portal/payments"))!;
    expect(recentLessonDuration(paymentsData.lessons, "student-maya")).toBe(60);
  });
});
