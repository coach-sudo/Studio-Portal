/* Development-only fixtures. This file is not an application entry or route. */
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { StudioStoreProvider } from "../src/state/StudioStore";
import { StudentPortal } from "../src/features/student/StudentPortal";
import { AutomationSettings } from "../src/features/coach/AutomationSettings";
import { demoSnapshot } from "../src/data/demo";
import { isSupabaseConfigured } from "../src/lib/supabase";
import { Dialog, EmptyState, PageSkeleton } from "../src/components/Primitives";
import "../src/styles.css";
import "../src/cohesion.css";
import "../src/app-system.css";
import "../src/styles/tokens.css";
import "../src/styles/product.css";
import "../src/styles/appearance.css";

if (
  !import.meta.env.DEV ||
  isSupabaseConfigured ||
  location.hostname !== "127.0.0.1"
) {
  throw new Error("Visual fixtures require an unconfigured local demo server.");
}
const view = new URLSearchParams(location.search).get("view");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={["/portal"]}>
      <StudioStoreProvider>
        {view === "guardian" ? (
          <Routes>
            <Route
              path="/portal/*"
              element={<StudentPortal role="guardian" />}
            />
          </Routes>
        ) : (
          <main className="page">
            <h1>Design fixtures</h1>
            {view === "automation" ? (
              <AutomationSettings data={demoSnapshot} isDemo />
            ) : view === "skeleton" ? (
              <PageSkeleton />
            ) : view === "empty" ? (
              <EmptyState
                title="Your schedule is clear"
                detail="Book a lesson when you’re ready to continue."
              />
            ) : (
              <Dialog
                title="Confirm action"
                description="Review this decision before continuing."
                onClose={() => {}}
              >
                <form className="workflow-form">
                  <label className="full">
                    Name
                    <input
                      aria-invalid="true"
                      aria-describedby="fixture-error"
                    />
                  </label>
                  <p
                    id="fixture-error"
                    className="inline-error full"
                    role="alert"
                  >
                    Enter a name to continue.
                  </p>
                  <div className="form-actions">
                    <button type="button">Cancel</button>
                    <button className="primary" type="button">
                      Confirm
                    </button>
                  </div>
                </form>
              </Dialog>
            )}
          </main>
        )}
      </StudioStoreProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);
