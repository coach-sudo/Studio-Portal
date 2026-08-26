import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { isValidTimezone, TimezoneSelect, worldTimezones } from "./TimezoneSelect";

describe("TimezoneSelect", () => {
  it("supports valid IANA timezones worldwide", async () => {
    const user = userEvent.setup(), change = vi.fn();
    render(<label>Timezone<TimezoneSelect value="" onChange={change} /></label>);
    await user.type(screen.getByLabelText("Timezone"), "Asia/Tokyo");
    expect(change).toHaveBeenCalled();
    expect(isValidTimezone("Asia/Tokyo")).toBe(true);
    expect(isValidTimezone("Not/A_Real_Zone")).toBe(false);
    expect(worldTimezones().length).toBeGreaterThan(20);
  });
});
