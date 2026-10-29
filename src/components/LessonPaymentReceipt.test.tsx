import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("../data/lessonPayments", () => ({
  loadLessonPayment: f.load,
  saveLessonPayment: f.save,
}));
import { LessonPaymentReceipt } from "./LessonPaymentReceipt";
import { ApiClientError } from "../data/apiClientError";
const lessonId = "e2920000-0000-4000-8000-000000000011";
const context = {
  lessonId,
  version: 1,
  eligible: true,
  reasonCode: null,
  remainingMinor: 6000,
  paidMinor: 0,
  priceMinor: 6000,
  currency: "USD",
  reviewToken: "a".repeat(64),
  studentId: "e2920000-0000-4000-8000-000000000002",
  participantId: null,
  bookingId: null,
  bookingVersion: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  f.load.mockResolvedValue({ context });
  f.save.mockResolvedValue({
    amountMinor: 1000,
    currency: "USD",
    receiptId: "e2920000-0000-4000-8000-000000000099",
  });
});
async function fill() {
  fireEvent.change(await screen.findByLabelText("Amount received (USD)"), {
    target: { value: "10.00" },
  });
  fireEvent.change(screen.getByLabelText("Payment reason"), {
    target: { value: "Cash received in studio" },
  });
}
it("records an amount received without a price or status editor", async () => {
  const saved = vi.fn().mockResolvedValue(undefined);
  render(
    <LessonPaymentReceipt lessonId={lessonId} isDemo={false} onSaved={saved} />,
  );
  await fill();
  expect(screen.queryByLabelText("Status")).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Lesson price/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  await screen.findByText(/Payment recorded:/);
  expect(f.save).toHaveBeenCalledWith(
    context,
    expect.objectContaining({
      amountMinor: 1000,
      method: "cash",
      currency: "USD",
      reason: "Cash received in studio",
    }),
  );
  expect(saved).toHaveBeenCalledOnce();
});
it("retains and locks the request after an unknown response", async () => {
  f.save.mockRejectedValueOnce(Error("Synthetic lost response"));
  render(
    <LessonPaymentReceipt
      lessonId={lessonId}
      isDemo={false}
      onSaved={vi.fn()}
    />,
  );
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Recover payment receipt" }),
  );
  await screen.findByText(/Payment recorded:/);
  expect(f.save.mock.calls[0]).toEqual(f.save.mock.calls[1]);
});
it("retains a lost-response request through revoked access and restores the same receipt", async () => {
  f.save
    .mockRejectedValueOnce(Error("Synthetic committed response lost"))
    .mockRejectedValueOnce(
      new ApiClientError(
        {
          code: "FORBIDDEN",
          message: "Coach access revoked",
          retryable: false,
        },
        403,
      ),
    );
  render(
    <LessonPaymentReceipt
      lessonId={lessonId}
      isDemo={false}
      onSaved={vi.fn()}
    />,
  );
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Recover payment receipt" }),
  );
  await screen.findByText(/Restore the original coach account/);
  expect(screen.getByLabelText("Amount received (USD)")).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Record payment" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Recover payment receipt" }),
  );
  await screen.findByText(/Payment recorded:/);
  expect(f.save).toHaveBeenCalledTimes(3);
  expect(f.save.mock.calls[2]).toEqual(f.save.mock.calls[0]);
});
it.each(["IDEMPOTENCY_CONFLICT", "VERSION_CONFLICT"])(
  "keeps the original request locked after %s instead of offering a new payment",
  async (code) => {
    f.save.mockRejectedValueOnce(
      new ApiClientError(
        { code, message: "Key conflict", retryable: false },
        409,
      ),
    );
    render(
      <LessonPaymentReceipt
        lessonId={lessonId}
        isDemo={false}
        onSaved={vi.fn()}
      />,
    );
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    await screen.findByText(/payment key needs financial review/);
    expect(screen.getByLabelText("Amount received (USD)")).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Record payment" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Recover payment receipt" }),
    );
    await screen.findByText(/Payment recorded:/);
    expect(f.save.mock.calls[1]).toEqual(f.save.mock.calls[0]);
  },
);
it("keeps committed success when downstream refresh fails", async () => {
  const saved = vi
    .fn()
    .mockRejectedValueOnce(Error("Synthetic refresh outage"))
    .mockResolvedValue(undefined);
  render(
    <LessonPaymentReceipt lessonId={lessonId} isDemo={false} onSaved={saved} />,
  );
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  await screen.findByText(/The payment is saved/);
  fireEvent.click(screen.getByRole("button", { name: "Refresh records" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  expect(f.save).toHaveBeenCalledOnce();
});
it("shows a financial review hold without a money submission", async () => {
  f.load.mockResolvedValue({
    context: {
      ...context,
      eligible: false,
      reasonCode: "historical_totals_review",
    },
  });
  render(
    <LessonPaymentReceipt
      lessonId={lessonId}
      isDemo={false}
      onSaved={vi.fn()}
    />,
  );
  await screen.findByText(/Existing paid totals need ledger review/);
  expect(
    screen.queryByRole("button", { name: "Record payment" }),
  ).not.toBeInTheDocument();
  expect(f.save).not.toHaveBeenCalled();
});
it("recovers a remounted unknown request even when fresh financial context is paid", async () => {
  const request = {
    lessonId,
    version: 1,
    reviewToken: context.reviewToken,
    amountMinor: 1000,
    currency: "USD",
    method: "cash",
    reason: "Cash received in studio",
  };
  f.load.mockResolvedValue({
    context: {
      ...context,
      eligible: false,
      remainingMinor: 0,
      reasonCode: "no_balance",
    },
    attempt: { request, key: "e2e-retained", context },
  });
  render(
    <LessonPaymentReceipt
      lessonId={lessonId}
      isDemo={false}
      onSaved={vi.fn()}
    />,
  );
  const retry = await screen.findByRole("button", {
    name: "Recover payment receipt",
  });
  expect(screen.getByLabelText("Amount received (USD)")).toHaveValue("10");
  expect(screen.getByLabelText("Amount received (USD)")).toBeDisabled();
  fireEvent.click(retry);
  await screen.findByText(/Payment recorded:/);
  expect(f.save).toHaveBeenCalledWith(context, request);
});
it("does not show a previous lesson receipt after the selected lesson changes", async () => {
  const view = render(
    <LessonPaymentReceipt
      lessonId={lessonId}
      isDemo={false}
      onSaved={vi.fn()}
    />,
  );
  await fill();
  fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
  await screen.findByText(/Payment recorded:/);
  const next = "e2920000-0000-4000-8000-000000000088";
  f.load.mockResolvedValue({ context: { ...context, lessonId: next } });
  view.rerender(
    <LessonPaymentReceipt lessonId={next} isDemo={false} onSaved={vi.fn()} />,
  );
  await screen.findByRole("button", { name: "Record payment" });
  expect(screen.queryByText(/Payment recorded:/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Amount received (USD)")).toHaveValue("");
});
