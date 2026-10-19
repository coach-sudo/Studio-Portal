// Local component acceptance entry only. Vite's application build excludes it.
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceLocationProvider } from "../../src/hooks/useWorkspaceLocation";
import { ResourceWorkspace } from "../../src/features/library/ResourceWorkspace";
import type { ResourceDetail } from "../../src/domain/library";
import "../../src/styles/tokens.css";
import "../../src/features/library/Library.css";

const kind = new URLSearchParams(location.search).get("kind") || "pdf";
const resource: ResourceDetail = {
  id: "e3400000-0000-4000-8000-000000000001",
  title: "Local study reader",
  description: "",
  source: "",
  keywords: [],
  version: 1,
  text:
    kind === "text"
      ? "Opening paragraph.\n\nSecond paragraph for rehearsal.\n\nFinal paragraph."
      : "",
  storagePath: kind === "text" ? undefined : "local-owned/" + kind,
  mimeType: (
    {
      pdf: "application/pdf",
      image: "image/png",
      audio: "audio/wav",
      video: "video/mp4",
      unsupported: "image/svg+xml",
    } as Record<string, string>
  )[kind],
  contentIdentity: "a".repeat(64),
};
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <MemoryRouter>
      <WorkspaceLocationProvider>
        <main
          style={{
            maxWidth: 1300,
            margin: "auto",
            padding: 12,
            fontFamily: "system-ui",
          }}
        >
          <h1>Local study reader</h1>
          <ResourceWorkspace
            resource={resource}
            studentId="e3300000-0000-4000-8000-000000000001"
            identity="e3100000-0000-4000-8000-000000000002"
            allowStudy={kind !== "unsupported"}
            isDemo={false}
          />
        </main>
      </WorkspaceLocationProvider>
    </MemoryRouter>
  </QueryClientProvider>,
);
