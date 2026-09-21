import { render } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import { Dialog, InlineNotice, ListControls } from "./Primitives";

async function expectAccessible(container: HTMLElement) {
  const result = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
  });
  expect(
    result.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

describe("shared accessibility patterns", () => {
  it("gives dialogs an accessible name and usable form labels", async () => {
    const { container } = render(
      <Dialog
        title="Fixture dialog"
        description="A deterministic component check."
        onClose={vi.fn()}
      >
        <label htmlFor="fixture-name">Name</label>
        <input id="fixture-name" />
      </Dialog>,
    );
    await expectAccessible(container);
  });

  it("keeps pagination controls named and keyboard-native", async () => {
    const { container } = render(
      <ListControls
        page={1}
        pageCount={2}
        pageSize={10}
        total={12}
        onPage={vi.fn()}
        onPageSize={vi.fn()}
        label="fixture records"
      />,
    );
    await expectAccessible(container);
  });

  it("announces status and error notices", async () => {
    const { container } = render(
      <>
        <InlineNotice>Saved.</InlineNotice>
        <InlineNotice tone="danger">Could not save.</InlineNotice>
      </>,
    );
    await expectAccessible(container);
  });
});
