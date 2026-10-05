import {
  useEffect,
  useMemo,
  useId,
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
  if (total === 0 || total <= pageSize) return null;
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
  return (
    <Dialog title={title} description={explanation} onClose={onClose}>
      <div className="workflow-content">
        <h3>Why this is here</h3>
        <ul>
          {evidence.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <div className="form-actions">
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
      </div>
    </Dialog>
  );
}

const overlayStack: Array<{ token: symbol; element: HTMLElement | null }> = [];
let originalOverflow = "";

/** Shared keyboard behavior for dialogs and side sheets, including nested overlays. */
function useOverlayFocus(onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const token = Symbol("overlay");
    if (!overlayStack.length) originalOverflow = document.body.style.overflow;
    overlayStack.push({ token, element: ref.current });
    document.body.style.overflow = "hidden";
    const controls = () =>
      [
        ...(ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"]):not(:disabled)',
        ) ?? []),
      ]
        .filter(
          (element) =>
            !element.closest('[hidden],[inert],[aria-hidden="true"]') &&
            getComputedStyle(element).display !== "none" &&
            getComputedStyle(element).visibility !== "hidden",
        )
        .sort((a, b) =>
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
            ? -1
            : 1,
        );
    if (!ref.current?.querySelector('[role="dialog"]'))
      (controls()[0] ?? ref.current)?.focus();
    const keydown = (event: KeyboardEvent) => {
      const top = overlayStack
        .filter(
          (entry) =>
            !overlayStack.some(
              (other) =>
                other !== entry &&
                other.element &&
                entry.element?.contains(other.element),
            ),
        )
        .at(-1);
      if (top?.token !== token) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const items = controls(),
        first = items[0],
        last = items.at(-1);
      if (!first) {
        event.preventDefault();
        ref.current?.focus();
        return;
      }
      if (
        !ref.current?.contains(document.activeElement) ||
        (!event.shiftKey && document.activeElement === last) ||
        (event.shiftKey && document.activeElement === first)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      overlayStack.splice(
        overlayStack.findIndex((entry) => entry.token === token),
        1,
      );
      if (!overlayStack.length) document.body.style.overflow = originalOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return ref;
}

type OverlayProps = {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
};

export function Dialog({
  title,
  description,
  children,
  onClose,
  presentation = "dialog",
}: OverlayProps & { presentation?: "dialog" | "drawer" }) {
  const ref = useOverlayFocus(onClose);
  const id = useId();
  return (
    <div
      className={`dialog-backdrop ${presentation === "drawer" ? "drawer-backdrop" : ""}`}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={ref}
        className={`workflow-dialog ${presentation === "drawer" ? "workflow-drawer" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id={`${id}-title`}>{title}</h2>
            {description && <p id={`${id}-description`}>{description}</p>}
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

export function Drawer(props: OverlayProps) {
  return <Dialog {...props} presentation="drawer" />;
}

export function PageSkeleton({
  label = "Opening your workspace…",
}: {
  label?: string;
}) {
  return (
    <div className="page-skeleton" role="status" aria-label={label}>
      <span className="visually-hidden">{label}</span>
      <div className="skeleton-heading" aria-hidden="true" />
      <div className="skeleton-subheading" aria-hidden="true" />
      <div className="skeleton-panels" aria-hidden="true">
        <div />
        <div />
        <div />
      </div>
    </div>
  );
}
