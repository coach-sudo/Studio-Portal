import { useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Section } from "../../components/Primitives";
import { readApiClientError } from "../../data/apiClientError";
import { useSearchIdentity } from "../../data/globalSearch";
import { portalContextLink } from "../../domain/coachingContext";
import { supabase } from "../../lib/supabase";
import { useLessonAutopayAccount } from "./useLessonAutopayOptions";

type PaymentMethodStatus = {
  available: boolean;
  hasSavedMethod?: boolean;
};
type Action = "payment-settings" | "payment-method" | "billing";

async function sendPaymentSettings(
  action: Action,
  studentId: string,
  signal?: AbortSignal,
) {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) throw new Error("Sign in again to review payment settings.");
  const response = await fetch(`/api/v2/portal/bookings/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ studentId }),
    signal,
  });
  if (!response.ok)
    throw await readApiClientError(
      response,
      "Payment settings could not be opened.",
    );
  return response.json();
}

export function StudentPaymentSettings({
  studentId,
  studentName,
  billingEmail,
  guardian,
  permitted,
  checking,
  isDemo,
}: {
  studentId: string;
  studentName: string;
  billingEmail?: string;
  guardian: boolean;
  permitted: boolean;
  checking: boolean;
  isDemo: boolean;
}) {
  const identity = useSearchIdentity();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState<Action>();
  const [error, setError] = useState("");
  const enabled = !!identity && permitted && !isDemo;
  const methods = useQuery<PaymentMethodStatus>({
    queryKey: ["payer-payment-settings", identity, studentId],
    queryFn: ({ signal }) =>
      sendPaymentSettings("payment-settings", studentId, signal),
    enabled,
    staleTime: 0,
    retry: false,
    refetchInterval: (query) =>
      params.get("payment") === "returned" &&
      query.state.data?.available &&
      !query.state.data.hasSavedMethod &&
      query.state.dataUpdateCount < 8
        ? 6000
        : false,
  });
  const autopay = useLessonAutopayAccount(studentId, enabled);
  const plan = autopay.data?.arrangement;
  const openStripe = async (action: "payment-method" | "billing") => {
    if (busy || !methods.data?.available || !enabled) return;
    setBusy(action);
    setError("");
    try {
      const { url } = await sendPaymentSettings(action, studentId);
      const destination = new URL(url);
      if (
        destination.protocol !== "https:" ||
        !["checkout.stripe.com", "billing.stripe.com"].includes(
          destination.hostname,
        )
      )
        throw new Error("Secure payment setup could not be opened.");
      window.location.assign(destination.href);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Secure payment setup could not be opened.",
      );
      setBusy(undefined);
    }
  };
  const authorization = plan?.needsReauthorization
    ? "Needs review"
    : plan?.status === "active"
      ? "Active"
      : plan?.status === "paused"
        ? "Paused"
        : autopay.data?.pending
          ? "Setup in progress"
          : !autopay.data
            ? "Status unavailable"
            : "Off";

  return (
    <div id="billing" className="settings-anchor">
      <Section title="Payment settings" marked>
        <div className="settings-list">
          <div className="data-summary">
            <div>
              <strong>Billing contact</strong>
              <small>
                {billingEmail || "Add your billing email in your profile."}
              </small>
              <a href="#profile-timezone">Edit contact details</a>
            </div>
          </div>
          {checking ? (
            <p role="status">Checking payment access…</p>
          ) : permitted ? (
            <>
              <p>
                {guardian
                  ? `You are authorized to pay for ${studentName}.`
                  : "You are responsible for your own lesson payments."}
              </p>
              <div className="data-summary">
                <CreditCard aria-hidden="true" />
                <div>
                  <strong>Payment methods</strong>
                  <small>
                    {isDemo
                      ? "Secure payment settings are unavailable in demo mode."
                      : methods.isPending
                        ? "Checking saved methods…"
                        : !methods.data?.available
                          ? "Saved payment methods are temporarily unavailable."
                          : methods.data.hasSavedMethod
                            ? "Payment method saved"
                            : params.get("payment") === "returned"
                            ? "Stripe hasn’t confirmed a saved method yet."
                              : "No saved payment method"}
                  </small>
                  <small>
                    One-time checkout does not require a saved card. Saving a
                    method does not authorize automatic charges.
                  </small>
                </div>
              </div>
              {error && <p role="alert">{error}</p>}
              {methods.data?.available && (
                <div className="form-actions">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => void openStripe("payment-method")}
                  >
                    {busy === "payment-method"
                      ? "Opening Stripe…"
                      : "Add payment method"}
                  </button>
                  {methods.data.hasSavedMethod && (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => void openStripe("billing")}
                    >
                      {busy === "billing"
                        ? "Opening Stripe…"
                        : "Manage saved methods"}
                    </button>
                  )}
                </div>
              )}
              <div className="data-summary">
                <div>
                  <strong>Automatic payments</strong>
                  <small>
                    {autopay.isLoading
                      ? "Checking authorization…"
                      : authorization}
                  </small>
                  {plan?.methodLabel && <small>{plan.methodLabel}</small>}
                  <Link
                    to={portalContextLink(
                      "/portal/payments?recurring=arrangements",
                      studentId,
                    )}
                  >
                    Review automatic payments
                  </Link>
                </div>
              </div>
              <Link to={portalContextLink("/portal/payments", studentId)}>
                View invoices, receipts, and payment history
              </Link>
            </>
          ) : (
            <p>
              {billingEmail
                ? "The studio can confirm who is responsible for lesson payments."
                : "Save your billing email to complete your contact information. Your studio can help confirm payment responsibility."}
            </p>
          )}
        </div>
      </Section>
    </div>
  );
}
