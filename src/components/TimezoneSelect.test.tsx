import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { isValidTimezone, TimezoneSelect, worldTimezones } from "./TimezoneSelect";

describe("TimezoneSelect", () => {
  it("supports valid IANA timezones worldwide", async () => {
    const user = userEvent.setup(), change = vi.fn();
    render(<label>Timezone<TimezoneSelect value="" onChange={change} /></label>);
    await user.selectOptions(screen.getByLabelText("Timezone"), "Asia/Tokyo");
    expect(change).toHaveBeenLastCalledWith("Asia/Tokyo");
    expect(isValidTimezone("Asia/Tokyo")).toBe(true);
    expect(isValidTimezone("Not/A_Real_Zone")).toBe(false);
    expect(worldTimezones().length).toBeGreaterThan(20);
  });

  it("offers the browser-observed timezone as the default choice", () => {
    const change = vi.fn();
    render(<TimezoneSelect value="" onChange={change} />);
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    expect(screen.getByRole("option", { name: `Device timezone — ${detected}` })).toBeInTheDocument();
    expect(change).toHaveBeenCalledWith(detected);
  });
});
