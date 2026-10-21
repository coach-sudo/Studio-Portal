import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { StudioForm } from "./StudioSettings";
import { demoSnapshot } from "../../data/demo";
import { uploadStudioFile } from "../../data/uploads";
vi.mock("../../data/uploads", () => ({ uploadStudioFile: vi.fn() }));
const image = () => new File(["image"], "logo.png", { type: "image/png" });
describe("studio branding save lifecycle", () => {
  it("awaits persistence and retains the previous image when a save fails", async () => {
    vi.mocked(uploadStudioFile).mockResolvedValue({
      id: "asset",
      storagePath: "studio/new",
      signedUrl: "never-persist-this",
    } as never);
    let reject!: (reason: Error) => void;
    const onSave = vi.fn(
      (_updates: Partial<typeof demoSnapshot.settings>) =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const value = structuredClone(demoSnapshot.settings);
    value.branding.logoUrl = "https://example.test/previous.png";
    value.branding.logoStoragePath = "studio/previous";
    render(<StudioForm value={value} studioId="studio" onSave={onSave} />);
    fireEvent.change(
      screen.getByLabelText("Studio logo", { selector: "input" }),
      { target: { files: [image()] } },
    );
    fireEvent.submit(
      screen.getByRole("button", { name: "Save studio" }).closest("form")!,
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("button", { name: "Saving studio…" }),
    ).toBeDisabled();
    expect(onSave.mock.calls[0][0].branding).toMatchObject({
      logoStoragePath: "studio/new",
      logoUrl: undefined,
    });
    reject(new Error("Settings save failed. Try again."));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Settings save failed",
    );
    expect(screen.getByAltText("Current studio logo")).toHaveAttribute(
      "src",
      "https://example.test/previous.png",
    );
    expect(screen.getByRole("button", { name: "Save studio" })).toBeEnabled();
  });
  it("rejects an invalid photo before any upload or save", async () => {
    vi.mocked(uploadStudioFile).mockClear();
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <StudioForm
        value={demoSnapshot.settings}
        studioId="studio"
        onSave={save}
      />,
    );
    fireEvent.change(
      screen.getByLabelText("Coach profile photo", { selector: "input" }),
      {
        target: {
          files: [new File(["bad"], "unsafe.svg", { type: "image/svg+xml" })],
        },
      },
    );
    fireEvent.submit(
      screen.getByRole("button", { name: "Save studio" }).closest("form")!,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PNG, JPEG or WebP",
    );
    expect(uploadStudioFile).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
