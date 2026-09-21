import { useQueryClient } from "@tanstack/react-query";
import { FolderOpen, Plus, UserRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ActorProfilePreview } from "../../components/ActorProfilePreview";
import {
  Dialog,
  EmptyState,
  Section,
  Status,
} from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import type { Student } from "../../domain/model";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { now, uid, type Data } from "./StudentWorkspace.shared";

export function ActorPage({
  data,
  student,
  isDemo,
  onAddMaterial,
}: {
  data: Data;
  student: Student;
  isDemo: boolean;
  onAddMaterial: () => void;
}) {
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const profile = data.actorProfiles.find((i) => i.studentId === student.id);
  const [previewing, setPreviewing] = useState(false);
  const create = async () => {
    if (isDemo)
      store.transact((draft) => {
        const target = draft.students.find((item) => item.id === student.id)!;
        target.actorPageEligible = true;
        draft.actorProfiles.push({
          id: uid("actor"),
          studentId: student.id,
          slug: student.fullName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, ""),
          displayName: student.fullName,
          bio: "",
          status: "draft",
          version: 1,
          updatedAt: now(),
        });
      });
    else {
      if (!student.actorPageEligible)
        await studioCommand("students", {
          command: "update",
          entityId: student.id,
          expectedVersion: student.version,
          payload: { actorPageEligible: true },
          reason: "Coach enabled actor page",
        });
      await studioCommand("actor-pages", {
        command: "create",
        expectedVersion: 0,
        payload: { studentId: student.id },
        reason: "Coach created actor page draft",
      });
      await invalidateStudioDomains(queryClient, ["students", "actorProfiles"]);
    }
  };
  const actorMaterials = data.materials.filter(
    (item) => item.studentId === student.id && item.role === "actor_material",
  );
  return (
    <div className="student-page">
      <Section title="Actor page" marked>
        {profile ? (
          <div className="profile-preview">
            <UserRound />
            <div>
              <span>/actors/{profile.slug}</span>
              <h2>{profile.displayName}</h2>
              <p>{profile.bio}</p>
            </div>
            <Status tone={profile.status === "published" ? "good" : "warn"}>
              {profile.status.replaceAll("_", " ")}
            </Status>
            <Link to="/coach/actor-pages">Open publishing workflow</Link>
            <button className="text-button" onClick={() => setPreviewing(true)}>
              Preview draft
            </button>
            {profile.status === "published" && (
              <a
                href={`/actors/${profile.slug}`}
                target="_blank"
                rel="noreferrer"
              >
                View live page
              </a>
            )}
          </div>
        ) : (
          <div>
            <EmptyState
              title="No actor page yet"
              detail="Start a private draft, then the student can add their bio and submit it for review."
            />
            <button className="primary-button" onClick={() => void create()}>
              <Plus />
              Create draft
            </button>
          </div>
        )}
      </Section>
      <Section
        title="Headshots, gallery, reel & résumé"
        aside={
          <button onClick={onAddMaterial}>
            <Plus />
            Add actor material
          </button>
        }
      >
        <p className="section-intro">
          These uploads are reserved for the public actor page and its review
          workflow.
        </p>
        <div className="table-list">
          {actorMaterials.map((item) => (
            <article key={item.id}>
              <FolderOpen />
              <div>
                <strong>{item.title}</strong>
                <small>
                  {item.category} · {item.approvalStatus.replaceAll("_", " ")}
                </small>
              </div>
              {item.externalUrl && (
                <a href={item.externalUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
              )}
            </article>
          ))}
          {!actorMaterials.length && (
            <EmptyState
              title="No actor-page media"
              detail="Add the main headshot, gallery photos, reel, and résumé here."
            />
          )}
        </div>
      </Section>
      {previewing && profile && (
        <Dialog
          title="Private actor-page preview"
          description="This uses the current draft and is not a public link."
          onClose={() => setPreviewing(false)}
        >
          <ActorProfilePreview
            profile={profile}
            materials={actorMaterials}
            studioName={data.settings.studioName}
            logoUrl={data.settings.branding.logoUrl}
          />
        </Dialog>
      )}
    </div>
  );
}
