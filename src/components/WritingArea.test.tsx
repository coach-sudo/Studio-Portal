import { createRef, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { WritingArea } from "./WritingArea";
it("preserves multiline values, validation, callbacks and a forwarded editing ref", () => {
  const ref = createRef<HTMLTextAreaElement>(),
    input = vi.fn();
  function Editor() {
    const [value, setValue] = useState("First line\nSecond line");
    return (
      <WritingArea
        ref={ref}
        aria-label="Lesson writing"
        required
        maxLength={10000}
        writingSize="long"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onInput={input}
      />
    );
  }
  render(<Editor />);
  const field = screen.getByRole("textbox");
  expect(ref.current).toBe(field);
  expect(field).toHaveValue("First line\nSecond line");
  expect(field).toHaveClass("writing-area-long");
  expect(field).toBeRequired();
  fireEvent.input(field, { target: { value: "Changed\nStill separate" } });
  expect(field).toHaveValue("Changed\nStill separate");
  expect(input).toHaveBeenCalledOnce();
});
it("grows to fit writing and preserves a manually enlarged surface", () => {
  render(<WritingArea aria-label="Instructions" defaultValue="Long content" />);
  const field = screen.getByRole("textbox") as HTMLTextAreaElement;
  Object.defineProperty(field, "scrollHeight", {
    configurable: true,
    value: 450,
  });
  Object.defineProperty(field, "clientHeight", {
    configurable: true,
    value: 160,
  });
  fireEvent.input(field);
  expect(field.style.height).toBe("452px");
  field.style.height = "600px";
  Object.defineProperty(field, "clientHeight", {
    configurable: true,
    value: 600,
  });
  fireEvent.input(field);
  expect(field.style.height).toBe("600px");
});
