import { useId } from "react";
export function CreditCancellationChoice({
  useCredit,
  onChange,
}: {
  useCredit: boolean;
  onChange: (use: boolean) => void;
}) {
  const name = useId();
  return (
    <fieldset className="policy-box">
      <legend>What happens to the applied credit?</legend>
      <label className="check-row">
        <input
          type="radio"
          name={name}
          checked={!useCredit}
          onChange={() => onChange(false)}
        />
        <span>
          <strong>Return credit</strong>
          <small>
            The credit goes back to the student’s available balance. An
            already-expired credit gets 30 days to be reused.
          </small>
        </span>
      </label>
      <label className="check-row">
        <input
          type="radio"
          name={name}
          checked={useCredit}
          onChange={() => onChange(true)}
        />
        <span>
          <strong>Use credit</strong>
          <small>
            This cancelled lesson uses the credit. It does not return to the
            student’s balance.
          </small>
        </span>
      </label>
    </fieldset>
  );
}
