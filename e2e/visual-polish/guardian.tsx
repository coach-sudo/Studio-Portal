// Local visual review only; excluded from the application build.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { StudentPortal } from "../../src/features/student/StudentPortal";
import { StudioStoreProvider } from "../../src/state/StudioStore";
import { WorkspaceLocationProvider } from "../../src/hooks/useWorkspaceLocation";
import "../../src/styles.css";
import "../../src/cohesion.css";
import "../../src/app-system.css";
import "../../src/styles/tokens.css";
import "../../src/styles/product.css";
const path = new URLSearchParams(location.search).get("path") || "/portal";
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <StudioStoreProvider>
      <MemoryRouter initialEntries={[path]}>
        <WorkspaceLocationProvider>
          <Routes>
            <Route
              path="/portal/*"
              element={<StudentPortal role="guardian" />}
            />
          </Routes>
        </WorkspaceLocationProvider>
      </MemoryRouter>
    </StudioStoreProvider>
  </QueryClientProvider>,
);
