import { expect, it } from "vitest";
import { demoSnapshot } from "../data/demo";
import {
  conflictDisposition,
  localSchedulingConflicts,
  studioOverlapPolicy,
} from "./schedulingConflicts";
it("matches the scheduled/private exclusion while preserving class and draft semantics", () => {
  for (const targetStatus of ["draft", "scheduled"])
    for (const otherStatus of ["draft", "scheduled"])
      for (const targetOffering of [undefined, "class"])
        for (const otherOffering of [undefined, "class"]) {
          const actual = studioOverlapPolicy(
            { status: targetStatus, offeringId: targetOffering },
            { status: otherStatus, offeringId: otherOffering },
          );
          const blocked =
            targetStatus === "scheduled" &&
            otherStatus === "scheduled" &&
            !targetOffering &&
            !otherOffering;
          expect(actual).toBe(blocked ? "private_overlap" : "studio_advisory");
        }
});
it("does not treat an old or inconsistent classification as permission to bypass a conflict", () => {
  const item = {
    id: "synthetic",
    summary: "Unknown",
    start: "2031-11-10T18:00:00Z",
    end: "2031-11-10T19:00:00Z",
  };
  expect(conflictDisposition(item)).toBe("unclassified");
  expect(
    conflictDisposition({
      ...item,
      source: "studio",
      policy: "private_overlap",
      blocksChange: false,
    }),
  ).toBe("unclassified");
  expect(
    conflictDisposition({
      ...item,
      source: "google",
      policy: "google_busy",
      blocksChange: false,
    }),
  ).toBe("google_override");
});
it("shares source-aware local checks, excludes self/cancelled/boundary touches and compares instants", () => {
  const target = {
    ...demoSnapshot.lessons[0],
    id: "selected",
    startsAt: "2031-11-10T18:00:00Z",
    endsAt: "2031-11-10T19:00:00Z",
    status: "scheduled" as const,
    offeringId: undefined,
  };
  const rows = [
    target,
    { ...target, id: "cancelled", status: "cancelled" as const },
    {
      ...target,
      id: "touches",
      startsAt: "2031-11-10T19:00:00Z",
      endsAt: "2031-11-10T20:00:00Z",
    },
    {
      ...target,
      id: "offset",
      startsAt: "2031-11-10T13:00:00-05:00",
      endsAt: "2031-11-10T14:00:00-05:00",
    },
  ];
  expect(
    localSchedulingConflicts(rows, target, target.startsAt, target.endsAt),
  ).toEqual([
    expect.objectContaining({
      id: "offset",
      source: "studio",
      policy: "private_overlap",
      blocksChange: true,
    }),
  ]);
});
