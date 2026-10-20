import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { demoSnapshot } from "../data/demo";
import { PublishedFeedback } from "./CoachingContinuity";

describe("published feedback continuity", () => {
  it("keeps private drafts and another child's feedback out of the selected workspace", () => {
    const data = structuredClone(demoSnapshot),
      studentId = data.students[0].id;
    data.role = "guardian";
    const note = {
      id: "shared",
      studentId,
      lessonId: "lesson",
      title: "Selected child feedback",
      body: "Shared",
      status: "published" as const,
      version: 1,
      updatedAt: "2026-10-20T12:00:00Z",
    };
    data.notes = [
      note,
      { ...note, id: "private", status: "draft", title: "PRIVATE DRAFT" },
      {
        ...note,
        id: "peer",
        studentId: data.students[1].id,
        title: "OTHER CHILD",
      },
    ];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <PublishedFeedback data={data} isDemo studentId={studentId} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Selected child feedback")).toBeVisible();
    expect(screen.queryByText("PRIVATE DRAFT")).not.toBeInTheDocument();
    expect(screen.queryByText("OTHER CHILD")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read feedback" })).toHaveAttribute(
      "href",
      `/portal/records/note/shared?student=${studentId}`,
    );
  });
});
