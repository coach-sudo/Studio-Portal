import { useEffect, useRef, type ReactNode } from "react";
import { ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";

export function PageHeader({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) { return <header className="page-header"><div><h1>{title}</h1>{children && <p>{children}</p>}</div>{action}</header>; }
export function Section({ title, marked, aside, children }: { title: string; marked?: boolean; aside?: ReactNode; children: ReactNode }) { return <section className={`section ${marked ? "marked" : ""}`}><header><h2>{title}</h2>{aside}</header>{children}</section>; }
export function ActionRow({ initials, title, detail, actionLabel = "Open", urgent, onClick }: { initials: string; title: string; detail: string; actionLabel?: string; urgent?: boolean; onClick?: () => void }) { return <div className={`action-row ${urgent ? "urgent" : ""}`}><span className="avatar">{initials}</span><div><strong>{title}</strong><small>{detail}</small></div><button type="button" onClick={onClick}>{actionLabel}<ChevronRight /></button></div>; }
export function EmptyState({ title, detail }: { title: string; detail: string }) { return <div className="empty-state"><CircleCheck /><div><strong>{title}</strong><small>{detail}</small></div></div>; }
export function Status({ tone = "neutral", children }: { tone?: "good" | "warn" | "danger" | "neutral"; children: ReactNode }) { return <span className={`status ${tone}`}>{tone === "warn" && <TriangleAlert />}{children}</span>; }
export function ExplanationDialog({ title, explanation, evidence, action, onClose }: { title: string; explanation: string; evidence: string[]; action: string; onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])') ?? [])];
      if (!controls.length) return;
      const edge = event.shiftKey ? controls[0] : controls.at(-1);
      if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, [onClose]);
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section ref={dialog} className="explanation-dialog" role="dialog" aria-modal="true" aria-labelledby="reason-title"><h2 id="reason-title">{title}</h2><p>{explanation}</p><h3>Why this is here</h3><ul>{evidence.map((item) => <li key={item}>{item}</li>)}</ul><div><button onClick={onClose}>Not now</button><button className="primary" onClick={onClose}>{action.replaceAll("_", " ")}</button></div></section></div>;
}
