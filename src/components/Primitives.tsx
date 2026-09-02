import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";
import type { StudioMutationStatus } from "../hooks/useStudioMutation";

export function PageActions({ children }: { children: ReactNode }) {
  return <div className="page-actions">{children}</div>;
}

export function DisclosureSection({
  title,
  children,
  open = false,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="disclosure-section" open={open}>
      <summary>{title}</summary>
      <div>{children}</div>
    </details>
  );
}

export function InlineNotice({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "danger";
}) {
  return (
    <p
      className={`inline-notice ${tone}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      {tone === "danger" ? <TriangleAlert /> : <CircleCheck />}
      <span>{children}</span>
    </p>
  );
}

export function MutationButton({
  status,
  idleLabel,
  savingLabel = "Saving…",
  ...props
}: {
  status: StudioMutationStatus;
  idleLabel: string;
  savingLabel?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <button {...props} disabled={props.disabled || status === "saving"}>
      {status === "saving" ? savingLabel : idleLabel}
    </button>
  );
}

export function PageHeader({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {action}
    </header>
  );
}
export function Section({
  title,
  marked,
  aside,
  children,
}: {
  title: string;
  marked?: boolean;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`section ${marked ? "marked" : ""}`}>
      <header>
        <h2>{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}
export function ActionRow({
  initials,
  title,
  detail,
  actionLabel = "Open",
  urgent,
  onClick,
}: {
  initials: string;
  title: string;
  detail: string;
  actionLabel?: string;
  urgent?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className={`action-row ${urgent ? "urgent" : ""}`}>
      <span className="avatar">{initials}</span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      <button type="button" onClick={onClick}>
        {actionLabel}
        <ChevronRight />
      </button>
    </div>
  );
}
export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <CircleCheck />
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}
export function Status({
  tone = "neutral",
  children,
}: {
  tone?: "good" | "warn" | "danger" | "neutral";
  children: ReactNode;
}) {
  return (
    <span className={`status ${tone}`}>
      {tone === "warn" && <TriangleAlert />}
      {children}
    </span>
  );
}

export function Toggle({
  checked,
  label,
  detail,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  label: string;
  detail?: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`setting-toggle toggle-button ${checked ? "on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span>
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <i aria-hidden="true">
        <b />
      </i>
    </button>
  );
}

export function usePagedList<T>(items: T[], initialSize = 10) {
  const [pageSize, setPageSize] = useState(initialSize);
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => setPage((value) => Math.min(value, pageCount)), [pageCount]);
  const visible = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize],
  );
  return {
    visible,
    page,
    setPage,
    pageSize,
    setPageSize,
    pageCount,
    total: items.length,
  };
}

export function ListControls({
  page,
  pageCount,
  pageSize,
  total,
  onPage,
  onPageSize,
  label = "items",
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  label?: string;
}) {
  return (
    <div className="list-controls" aria-label={`${label} display controls`}>
      <label>
        Show{" "}
        <select
          value={pageSize}
          onChange={(event) => {
            onPageSize(Number(event.target.value));
            onPage(1);
          }}
        >
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </label>
      <span>
        {total
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`
          : `0 ${label}`}
      </span>
      <div>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
export function ExplanationDialog({
  title,
  explanation,
  evidence,
  action,
  onClose,
  onAction,
}: {
  title: string;
  explanation: string;
  evidence: string[];
  action: string;
  onClose: () => void;
  onAction?: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const controls = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      if (!controls.length) return;
      const edge = event.shiftKey ? controls[0] : controls.at(-1);
      if (document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialog}
        className="explanation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reason-title"
      >
        <h2 id="reason-title">{title}</h2>
        <p>{explanation}</p>
        <h3>Why this is here</h3>
        <ul>
          {evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div>
          <button onClick={onClose}>Not now</button>
          <button
            className="primary"
            onClick={() => {
              onAction?.();
              onClose();
            }}
          >
            {action.replaceAll("_", " ")}
          </button>
        </div>
      </section>
    </div>
  );
}

export function Dialog({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current
      ?.querySelector<HTMLElement>("input,select,textarea,button")
      ?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const controls = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      if (!controls.length) return;
      const first = controls[0],
        last = controls.at(-1);
      if (
        (!event.shiftKey && document.activeElement === last) ||
        (event.shiftKey && document.activeElement === first)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialog}
        className="workflow-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workflow-dialog-title"
      >
        <header>
          <div>
            <h2 id="workflow-dialog-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
