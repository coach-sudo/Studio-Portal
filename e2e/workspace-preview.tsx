// Role adapter for local browser journeys, using the real portal and router.
import { demoSnapshot } from "../src/data/demo";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { StudioStoreProvider } from "../src/state/StudioStore";
import { StudentPortal } from "../src/features/student/StudentPortal";
import {
  WorkspaceLocationProvider,
  installWorkspaceHistoryGuard,
} from "../src/hooks/useWorkspaceLocation";
import { isSupabaseConfigured } from "../src/lib/supabase";
import "../src/styles.css";
import "../src/cohesion.css";
import "../src/app-system.css";
import "../src/styles/tokens.css";
import "../src/styles/product.css";

if (
  !import.meta.env.DEV ||
  isSupabaseConfigured ||
  location.hostname !== "127.0.0.1"
)
  throw new Error(
    "This adapter requires an unconfigured loopback development server.",
  );
if (!localStorage.getItem("stage-story-studio-core-v2")) {
  const students = structuredClone(demoSnapshot.students);
  for (const student of students)
    if (["student-sarah", "student-maya"].includes(student.id))
      student.guardianEmail = "family@example.test";
  localStorage.setItem(
    "stage-story-studio-core-v2",
    JSON.stringify({ students }),
  );
}
installWorkspaceHistoryGuard();
ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <BrowserRouter>
      <StudioStoreProvider>
        <WorkspaceLocationProvider>
          <Routes>
            <Route
              path="/portal/*"
              element={<StudentPortal role="guardian" />}
            />
          </Routes>
        </WorkspaceLocationProvider>
      </StudioStoreProvider>
    </BrowserRouter>
  </QueryClientProvider>,
);
