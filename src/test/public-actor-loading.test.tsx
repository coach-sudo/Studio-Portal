import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PublicActorPage } from "../features/public/PublicActorPage";
import { useStudioRoute } from "../hooks/useStudio";

vi.mock("../hooks/useStudio", () => ({ useStudioRoute: vi.fn() }));
vi.mock("../lib/supabase", () => ({ isDemoMode: false }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("public actor loading", () => {
  it("loads only the public endpoint, not authenticated studio domains", async () => {
    const fetchActor = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        studio: { name: "Studio", branding: {} },
        displayName: "E2E Actor",
        bio: "A performer",
        materials: [],
      }),
    });
    vi.stubGlobal("fetch", fetchActor);

    render(
      <MemoryRouter initialEntries={["/actors/e2e-actor"]}>
        <Routes>
          <Route path="/actors/:slug" element={<PublicActorPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "E2E Actor" })).toBeInTheDocument();
    expect(fetchActor).toHaveBeenCalledTimes(1);
    expect(fetchActor).toHaveBeenCalledWith(
      "/api/v2/public/actors/e2e-actor",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(useStudioRoute).not.toHaveBeenCalled();
  });
});
