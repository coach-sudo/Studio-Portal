import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Drawer, Dialog } from "./Primitives";

describe("overlay keyboard navigation", () => {
  it("wraps focus past disabled and hidden fields and restores the opener", async () => {
    const user = userEvent.setup();
    const opener = document.createElement("button");
    document.body.append(opener);
    opener.focus();
    const close = vi.fn();
    const { unmount } = render(
      <Drawer
        title="Edit service"
        description="Service configuration"
        onClose={close}
      >
        <input aria-label="Disabled field" disabled />
        <input aria-label="Hidden field" hidden />
        <input aria-label="Name" />
        <button>Save</button>
      </Drawer>,
    );
    const first = screen.getByRole("button", { name: "Close" });
    expect(first).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(close).toHaveBeenCalledOnce();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).not.toBe("hidden");
    opener.remove();
  });
  it("gives concurrent overlays distinct labels and sends Escape only to the top overlay", async () => {
    const outer = vi.fn(),
      inner = vi.fn(),
      user = userEvent.setup();
    render(
      <Dialog title="Outer" onClose={outer}>
        <Drawer title="Inner" onClose={inner}>
          <button>Done</button>
        </Drawer>
      </Dialog>,
    );
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs[0].getAttribute("aria-labelledby")).not.toBe(
      dialogs[1].getAttribute("aria-labelledby"),
    );
    await user.keyboard("{Escape}");
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });
});
