import { ShieldCheck } from "lucide-react";
import { useParams } from "react-router-dom";
import { PageHeader } from "../../components/Primitives";
import { useStudio } from "../../hooks/useStudio";
import { StudioSettings } from "./StudioSettings";
import { StudentsIndex } from "./StudentsIndex";
import {
  ActorPagesView,
  FinanceView,
  LessonsView,
  MaterialsView,
  NotesView,
  TodayView,
} from "./StudioOperations";

const configs: Record<string, { title: string; description: string }> = {
  today: {
    title: "Today",
    description:
      "Preparation, teaching, notes, and follow-up in one continuous flow.",
  },
  students: {
    title: "Students",
    description:
      "People, relationships, access, current work, and the next meaningful action.",
  },
  lessons: {
    title: "Lessons",
    description: "The complete schedule and every lesson’s current state.",
  },
  notes: {
    title: "Notes",
    description:
      "Private drafts and intentionally published student follow-up.",
  },
  materials: {
    title: "Materials",
    description: "One library with clear ownership, visibility, and history.",
  },
  finance: {
    title: "Payments",
    description: "Balances, package credits, payments, and adjustments.",
  },
  "actor-pages": {
    title: "Actor Pages",
    description: "Draft, review, approval, and publishing.",
  },
  settings: {
    title: "Settings",
    description:
      "Studio identity, student experience, pricing, connections, and recovery.",
  },
};
export function CoachSection() {
  const { section = "today" } = useParams(),
    config = configs[section] ?? configs.today,
    { data, isDemo } = useStudio();
  if (!data)
    return <div className="loading">Loading {config.title.toLowerCase()}…</div>;
  return (
    <div className="page">
      <PageHeader title={config.title}>{config.description}</PageHeader>
      {isDemo && (
        <p className="portal-notice">
          <ShieldCheck />
          Studio changes are saved on this device. Booking and payment providers
          remain in preview until their live credentials are connected.
        </p>
      )}
      {section === "today" && <TodayView data={data} isDemo={isDemo} />}{" "}
      {section === "students" && <StudentsIndex data={data} isDemo={isDemo} />}{" "}
      {section === "lessons" && <LessonsView data={data} isDemo={isDemo} />}{" "}
      {section === "notes" && <NotesView data={data} isDemo={isDemo} />}{" "}
      {section === "materials" && <MaterialsView data={data} isDemo={isDemo} />}{" "}
      {section === "finance" && <FinanceView data={data} isDemo={isDemo} />}{" "}
      {section === "actor-pages" && (
        <ActorPagesView data={data} isDemo={isDemo} />
      )}{" "}
      {section === "settings" && <StudioSettings data={data} isDemo={isDemo} />}
    </div>
  );
}
