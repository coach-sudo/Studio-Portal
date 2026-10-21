import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { demoSnapshot } from "../../data/demo";
import { StudioStoreProvider } from "../../state/StudioStore";
import { ActorPagesView } from "./StudioActorPages";

describe("Actor publishing list", () => {
  it("distinguishes a requested draft review from its still published page", () => {
    const data = structuredClone(demoSnapshot);
    data.actorProfiles = [
      {
        ...data.actorProfiles[0],
        status: "published",
        draftStatus: "review_requested",
      },
    ];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <StudioStoreProvider>
            <ActorPagesView data={data} isDemo />
          </StudioStoreProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText("published", { exact: true })).toBeInTheDocument();
    expect(
      screen.getByText("Draft: review requested", { exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review draft" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review & publish" }),
    ).not.toBeInTheDocument();
  });
});
