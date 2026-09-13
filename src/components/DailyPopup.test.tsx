import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { DailyPopup } from "./DailyPopup";
import type { StudioSettings } from "../domain/model";

const popup: StudioSettings["dailyPopup"] = {
  enabled: true,
  heading: "Studio news",
  body: "Registration opens today.",
  backgroundColor: "#173f35",
  backgroundImageUrl: "",
  textTone: "light",
  alignment: "center",
  style: "simple",
};

describe("daily popup", () => {
  beforeEach(() => localStorage.clear());

  it("appears once per day per portal viewer and is easy to dismiss", async () => {
    const user = userEvent.setup();
    const first = render(
      <DailyPopup popup={popup} studioId="studio" viewerId="student-a" />,
    );
    expect(
      await screen.findByRole("dialog", { name: "Studio news" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Close announcement" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    first.unmount();

    const second = render(
      <DailyPopup popup={popup} studioId="studio" viewerId="student-a" />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    second.unmount();

    render(<DailyPopup popup={popup} studioId="studio" viewerId="student-b" />);
    expect(
      await screen.findByRole("dialog", { name: "Studio news" }),
    ).toBeInTheDocument();
  });

  it("stays hidden when disabled", () => {
    render(
      <DailyPopup
        popup={{ ...popup, enabled: false }}
        studioId="studio"
        viewerId="student-a"
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
