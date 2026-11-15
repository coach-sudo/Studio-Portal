import type { CreditPackageBalance } from "../domain/creditCoverage";

export function CreditPackageMetrics({
  balance,
}: {
  balance: CreditPackageBalance;
}) {
  return (
    <>
      <small>
        {balance.services.join(", ") || "Service unverified"}
        {balance.durationMinutes
          ? " · " + balance.durationMinutes + " min"
          : ""}
        {!balance.eligibilityVerified && " · Eligibility needs review"}
      </small>
      <small>
        {balance.unused} unused · {balance.reserved} reserved ·{" "}
        {balance.available} available · {balance.consumed} consumed
      </small>
    </>
  );
}
