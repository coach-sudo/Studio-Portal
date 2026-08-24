import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { demoSnapshot } from "../data/demo";
import { LessonWhiteboard } from "./LessonWhiteboard";

const renderBoard = () => {
  const data = structuredClone(demoSnapshot);
  data.lessonWhiteboards = [];
  const lesson = data.lessons[0], student = data.students.find((item) => item.id === lesson.studentId)!;
  return render(<QueryClientProvider client={new QueryClient()}><LessonWhiteboard data={data} lesson={lesson} student={student} isDemo onDemoChange={vi.fn()} /></QueryClientProvider>);
};

describe("optional lesson whiteboard", () => {
  it("does not create or render a board until Add whiteboard is chosen", async () => {
    const user = userEvent.setup();
    renderBoard();
    expect(screen.queryByRole("dialog", { name: "Lesson whiteboard" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add whiteboard/i }));
    expect(screen.getByRole("dialog", { name: "Lesson whiteboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lets Escape leave a drawing tool before closing the modal", async () => {
    const user = userEvent.setup(); renderBoard();
    await user.click(screen.getByRole("button", { name: /Add whiteboard/i }));
    await user.click(screen.getByRole("button", { name: "Text" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Move" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("dialog", { name: "Lesson whiteboard" })).toBeInTheDocument();
  });
});
