import { useQueryClient } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  EmptyState,
  Section,
  Status,
  Dialog,
} from "../../components/Primitives";
import { ActorProfilePreview } from "../../components/ActorProfilePreview";
import type { ActorProfile } from "../../domain/model";
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
    [notice, setNotice] = useState(""),
    [review, setReview] = useState<{
      profile: ActorProfile;
      status: ActorProfileStatus;
    }>(),
    [busy, setBusy] = useState(false);
  const change = async (
    id: string,
    status: ActorProfileStatus,
    version: number,
  ) => {
    if (busy) return;
    setBusy(true);
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
          expectedVersion: version,
          payload: { status },
          reason: "Coach reviewed actor page",
        });
        await invalidateStudioDomains(queryClient, ["actorProfiles"]);
      }
      setNotice(`Actor page marked ${status.replaceAll("_", " ")}.`);
      setReview(undefined);
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Actor page could not be updated.",
      );
    } finally {
      setBusy(false);
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
            {profile.draftStatus && (
              <Status
                tone={profile.draftStatus === "approved" ? "good" : "warn"}
              >
                Draft: {profile.draftStatus.replaceAll("_", " ")}
              </Status>
            )}
            <button
              onClick={() =>
                navigate(`/coach/students/${profile.studentId}/actor-page`)
              }
            >
              Open
            </button>
            {(profile.draftStatus || profile.status) !== "approved" && (
              <button
                onClick={() => setReview({ profile, status: "approved" })}
              >
                Review draft
              </button>
            )}
            {(profile.draftStatus || profile.status) === "approved" && (
              <button
                onClick={() => setReview({ profile, status: "published" })}
              >
                Review & publish
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
                  onClick={() =>
                    setReview({ profile, status: "changes_requested" })
                  }
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
      {review && (
        <Dialog
          title={
            review.status === "published"
              ? "Publish reviewed revision"
              : review.status === "approved"
                ? "Approve draft"
                : "Unpublish Actor Page"
          }
          onClose={() => !busy && setReview(undefined)}
        >
          <p>
            {review.status === "published"
              ? "The approved content and approved media below will replace the public revision."
              : review.status === "approved"
                ? "Approval records this draft version. Publication remains a separate action."
                : "The public URL becomes unavailable. Revisions and authored content remain in history."}
          </p>
          <ActorProfilePreview
            profile={review.profile}
            materials={data.materials.filter(
              (m) =>
                m.studentId === review.profile.studentId &&
                m.role === "actor_material",
            )}
            studioName={data.settings.studioName}
            logoUrl={data.settings.branding.logoUrl}
          />
          <div className="form-actions">
            <button disabled={busy} onClick={() => setReview(undefined)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                data.actorProfiles.find((p) => p.id === review.profile.id)
                  ?.version !== review.profile.version
              }
              onClick={() =>
                void change(
                  review.profile.id,
                  review.status,
                  review.profile.version,
                )
              }
            >
              {busy
                ? "Saving…"
                : review.status === "published"
                  ? "Confirm publication"
                  : review.status === "approved"
                    ? "Confirm approval"
                    : "Confirm unpublish"}
            </button>
          </div>
        </Dialog>
      )}
    </Section>
  );
}
