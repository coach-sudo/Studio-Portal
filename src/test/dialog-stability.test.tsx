import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "../components/Primitives";

function EditableDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState("");
  return (
    <Dialog title="Adjust lesson credits" onClose={() => onClose()}>
      <label>
        Reason
        <input
          aria-label="Reason"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("stays open and keeps typed input when its close callback identity changes", async () => {
    const close = vi.fn();
    render(<EditableDialog onClose={close} />);
    const input = screen.getByLabelText("Reason");
    await userEvent.type(input, "Lesson credit");
    expect(input).toHaveValue("Lesson credit");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
  });
});
