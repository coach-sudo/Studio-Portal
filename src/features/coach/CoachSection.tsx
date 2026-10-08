import { ShieldCheck } from "lucide-react";
import { useParams } from "react-router-dom";
import { PageHeader, PageSkeleton } from "../../components/Primitives";
import { useStudioRoute } from "../../hooks/useStudio";
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
import { coachSectionDomains } from "./routeDomains";

const configs: Record<string, { title: string }> = {
  today: { title: "Today" },
  students: { title: "Students" },
  lessons: { title: "Lessons" },
  notes: { title: "Notes" },
  materials: { title: "Materials" },
  finance: { title: "Payments" },
  "actor-pages": { title: "Actor Pages" },
  settings: { title: "Settings" },
};
export function CoachSection() {
  const { section = "today" } = useParams(),
    config = configs[section] ?? configs.today,
    { data, isDemo } = useStudioRoute(
      "coach",
      undefined,
      coachSectionDomains(section),
    );
  if (!data)
    return <PageSkeleton label={`Loading ${config.title.toLowerCase()}…`} />;
  return (
    <div className={`page page-${section}`}>
      <PageHeader title={config.title} />
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
