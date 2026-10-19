import { PageHeader, PageSkeleton } from "../../components/Primitives";
import { RecordUnavailable } from "../../components/RecordRoute";
import { useStudioRoute } from "../../hooks/useStudio";
import { coachSectionDomains } from "./routeDomains";
import { TodayView } from "./StudioToday";
export function CoachToday() {
  const { data, isDemo, error } = useStudioRoute(
    "coach",
    undefined,
    coachSectionDomains("today"),
  );
  if (error) return <RecordUnavailable fallback="/coach/today" />;
  if (!data) return <PageSkeleton label="Preparing Today…" />;
  return (
    <div className="page page-today">
      <PageHeader title="Today" />
      <TodayView data={data} isDemo={isDemo} />
    </div>
  );
}
