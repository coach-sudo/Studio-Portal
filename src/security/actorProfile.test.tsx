import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import {
  ActorPageContent,
  type PublicActor,
} from "../components/ActorPageRenderer";
const actor: PublicActor = {
  studio: { name: "E2E Studio", branding: {} },
  displayName: "E2E Actor",
  bio: '<img src=x onerror="window.__actorXss=true"><script>bad()</script>',
  materials: [
    {
      id: "youtube",
      title: "Safe reel",
      category: "video",
      url: "https://youtu.be/scene-1",
      media_kind: "link",
    },
    {
      id: "vimeo",
      title: "Vimeo reel",
      category: "video",
      url: "https://vimeo.com/12345",
      media_kind: "link",
    },
    {
      id: "untrusted",
      title: "Untrusted embed",
      category: "link",
      url: "https://evil.test/youtube.com",
      media_kind: "link",
    },
  ],
};
it.each([true, false])(
  "renders malicious profile text inertly in preview=%s and preserves allowed reels",
  (preview) => {
    const { container } = render(
      <MemoryRouter>
        <ActorPageContent actor={actor} preview={preview} />
      </MemoryRouter>,
    );
    expect(screen.getByText(actor.bio)).toBeVisible();
    expect(container.querySelector("script,[onerror]")).toBeNull();
    expect(screen.getByTitle("Safe reel")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/scene-1",
    );
    expect(screen.getByTitle("Vimeo reel")).toHaveAttribute(
      "src",
      "https://player.vimeo.com/video/12345",
    );
    expect(screen.queryByTitle("Untrusted embed")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open Untrusted embed" }),
    ).toHaveAttribute("href", "https://evil.test/youtube.com");
  },
);
