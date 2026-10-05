import { describe, expect, it } from "vitest";
import { resolveBookingGuestRecipients } from "./bookingGuestRecipients";
const booking = {
  for_minor: true,
  guest_email: "minor@example.test",
  guardian_email: "payer@example.test",
};
describe("scoped pre-account booking recipients", () => {
  it("a guest minor never receives failed-payment or package billing", () => {
    for (const intent of [
      "payment_failed",
      "payment_due",
      "package_low",
    ] as const)
      expect(
        resolveBookingGuestRecipients(booking, intent).recipients.map(
          (item) => item.email,
        ),
      ).toEqual(["payer@example.test"]);
  });
  it("missing guardian is unresolved, not a fallback to the child", () => {
    expect(
      resolveBookingGuestRecipients(
        { ...booking, guardian_email: null },
        "payment_failed",
      ),
    ).toMatchObject({
      recipients: [],
      unresolved: expect.arrayContaining([expect.any(String)]),
    });
  });
  it("adult guest billing is deterministic and normalized", () => {
    expect(
      resolveBookingGuestRecipients(
        { ...booking, for_minor: false, guest_email: " ADULT@example.test " },
        "payment_due",
      ).recipients.map((item) => item.email),
    ).toEqual(["adult@example.test"]);
  });
  it("guest logistics deduplicate identities without granting private work access", () => {
    expect(
      resolveBookingGuestRecipients(
        { ...booking, guardian_email: "MINOR@example.test" },
        "lesson_confirmation",
      ).recipients,
    ).toHaveLength(1);
    expect(
      resolveBookingGuestRecipients(booking, "lesson_content").recipients,
    ).toEqual([]);
  });
});
