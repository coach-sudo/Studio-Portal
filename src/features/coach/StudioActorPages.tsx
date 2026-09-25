import { useQueryClient } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState, Section, Status } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import type { ActorProfileStatus, StudioSnapshot } from "../../domain/model";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { studentName } from "./StudioOperations.shared";

export function ActorPagesView({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const store = useStudioStore(),
    navigate = useNavigate(),
    queryClient = useQueryClient(),
    [notice, setNotice] = useState("");
  const change = async (id: string, status: ActorProfileStatus) => {
    const profile = data.actorProfiles.find((item) => item.id === id)!;
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.actorProfiles.find((i) => i.id === id)!;
          item.status = status;
          item.version += 1;
          item.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("actor-pages", {
          command: "review",
          entityId: id,
          expectedVersion: profile.version,
          payload: { status },
          reason: "Coach reviewed actor page",
        });
        await invalidateStudioDomains(queryClient, ["actorProfiles"]);
      }
      setNotice(`Actor page marked ${status.replaceAll("_", " ")}.`);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Actor page could not be updated.",
      );
    }
  };
  return (
    <Section title="Publishing workflow" marked>
      {notice && <p className="portal-notice">{notice}</p>}
      <div className="table-list">
        {data.actorProfiles.map((profile) => (
          <article key={profile.id}>
            <UserRound />
            <div>
              <strong>{profile.displayName}</strong>
              <small>
                /actors/{profile.slug} · {studentName(data, profile.studentId)}
              </small>
            </div>
            <Status tone={profile.status === "published" ? "good" : "warn"}>
              {profile.status.replaceAll("_", " ")}
            </Status>
            <button
              onClick={() =>
                navigate(`/coach/students/${profile.studentId}/actor-page`)
              }
            >
              Open
            </button>
            {profile.status === "review_requested" && (
              <button onClick={() => void change(profile.id, "approved")}>
                Approve
              </button>
            )}
            {profile.status !== "published" && (
              <button onClick={() => void change(profile.id, "published")}>
                Publish
              </button>
            )}
            {profile.status === "published" && (
              <>
                <a
                  className="button-link"
                  href={`/actors/${profile.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View live page
                </a>
                <button
                  onClick={() => void change(profile.id, "changes_requested")}
                >
                  Unpublish
                </button>
              </>
            )}
          </article>
        ))}
        {!data.actorProfiles.length && (
          <EmptyState
            title="No actor pages"
            detail="Create a draft from an eligible student record."
          />
        )}
      </div>
    </Section>
  );
}
