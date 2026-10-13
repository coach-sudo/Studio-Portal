import { useId, useState, type InputHTMLAttributes } from "react";

export function PasswordInput({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const id = props.id || generatedId;
  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <span className="password-input">
        <input {...props} id={id} type={visible ? "text" : "password"} />
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </span>
    </div>
  );
}
