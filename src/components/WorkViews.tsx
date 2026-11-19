import "./MyWork.css";
import { Link, useSearchParams } from "react-router-dom";
import { BookOpen, ClipboardList, FileText } from "lucide-react";

const views = [
  { id: "homework", label: "Homework", Icon: ClipboardList },
  { id: "notes", label: "Lesson notes", Icon: BookOpen },
  { id: "scripts", label: "Scripts", Icon: FileText },
] as const;

import { useWorkView } from "../hooks/useWorkView";

export function WorkViews() {
  const view = useWorkView();
  const [params] = useSearchParams();
  return (
    <nav className="record-tabs work-views" aria-label="My Work sections">
      {views.map(({ id, label, Icon }) => {
        const next = new URLSearchParams();
        const student = params.get("student");
        if (student) next.set("student", student);
        if (id !== "homework") next.set("view", id);
        return (
          <Link
            key={id}
            to={{ search: next.toString() }}
            className={view === id ? "active" : undefined}
            aria-current={view === id ? "page" : undefined}
          >
            <Icon aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
