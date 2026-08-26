import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssignmentActivity } from "./AssignmentActivity";
import type { Assignment } from "../domain/model";

const assignment = (overrides: Partial<Assignment>): Assignment => ({
  id: "assignment-1", studentId: "student-1", title: "Scene preparation",
  details: "Complete the activity before the lesson.", status: "assigned",
  helpRequested: false, version: 1, updatedAt: new Date().toISOString(), ...overrides,
});

describe("AssignmentActivity", () => {
  it("saves separate Q&A responses", async () => {
    const user = userEvent.setup(), onSave = vi.fn().mockResolvedValue(undefined);
    render(<AssignmentActivity assignment={assignment({ activityType: "qa", activityConfig: { prompts: ["What changed?", "What will you try?"] } })} busy={false} onSave={onSave} onComplete={vi.fn()} onHelp={vi.fn()} />);
    await user.type(screen.getByLabelText("What changed?"), "My objective became specific.");
    await user.type(screen.getByLabelText("What will you try?"), "Listen before responding.");
    await user.click(screen.getByRole("button", { name: "Save progress" }));
    expect(onSave).toHaveBeenCalledWith({ "answer-0": "My objective became specific.", "answer-1": "Listen before responding." });
  });

  it("supports a journal response that can be resumed", async () => {
    const user = userEvent.setup(), onSave = vi.fn().mockResolvedValue(undefined);
    render(<AssignmentActivity assignment={assignment({ activityType: "journal", responses: { journal: "First thought" } })} busy={false} onSave={onSave} onComplete={vi.fn()} onHelp={vi.fn()} />);
    await user.type(screen.getByLabelText("Your reflection"), " and second thought");
    await user.click(screen.getByRole("button", { name: "Save progress" }));
    expect(onSave).toHaveBeenCalledWith({ journal: "First thought and second thought" });
  });

  it("supports multiple choice and action checklists", async () => {
    const user = userEvent.setup(), multipleSave = vi.fn().mockResolvedValue(undefined);
    const { unmount } = render(<AssignmentActivity assignment={assignment({ activityType: "multiple_choice", activityConfig: { options: ["Objective", "Obstacle"] } })} busy={false} onSave={multipleSave} onComplete={vi.fn()} onHelp={vi.fn()} />);
    await user.click(screen.getByLabelText("Obstacle"));
    await user.click(screen.getByRole("button", { name: "Save progress" }));
    expect(multipleSave).toHaveBeenCalledWith({ choice: "Obstacle" });
    unmount();
    const checklistSave = vi.fn().mockResolvedValue(undefined);
    render(<AssignmentActivity assignment={assignment({ activityType: "checklist", activityConfig: { items: ["Print sides", "Warm up"] } })} busy={false} onSave={checklistSave} onComplete={vi.fn()} onHelp={vi.fn()} />);
    await user.click(screen.getByLabelText("Print sides"));
    await user.click(screen.getByRole("button", { name: "Save progress" }));
    expect(checklistSave).toHaveBeenCalledWith({ "item-0": true });
  });
});
