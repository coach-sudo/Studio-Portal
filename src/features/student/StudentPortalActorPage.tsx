import { useQueryClient } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { useState } from "react";
import { ActorProfilePreview } from "../../components/ActorProfilePreview";
import "../../components/IdentityActions.css";
import { Drawer, Section, Status } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import {
  type ActorPortfolioDraft,
  type Snapshot,
} from "./StudentPortal.shared";

import { PortalList } from "./StudentPortalList";
import { Materials } from "./StudentPortalWorkContent";
import { ActorBuilder } from "../../components/ActorBuilder";

export function ActorPage({
  data,
  isDemo,
}: {
  data: Snapshot;
  isDemo: boolean;
}) {
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const profile = data.actorProfiles[0];
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [notice, setNotice] = useState("");
  if (!profile)
    return (
      <PortalList
        title="Actor Page"
        description="Create and submit a profile for coach review."
        items={[]}
      />
    );
  const save = async (
    displayName: string,
    bio: string,
    portfolio: ActorPortfolioDraft,
    submit: boolean,
  ) => {
    try {
      if (isDemo)
        store.transact((draft) => {
          const item = draft.actorProfiles.find(
            (row) => row.id === profile.id,
          )!;
          item.displayName = displayName;
          item.bio = bio;
          item.draftContent = portfolio;
          item.draftStatus = submit ? "review_requested" : "draft";
          if (item.status !== "published") item.status = item.draftStatus;
          item.version += 1;
          item.updatedAt = new Date().toISOString();
        });
      else {
        await studioCommand("actor-pages", {
          command: "save",
          entityId: profile.id,
          expectedVersion: profile.version,
          reason: submit
            ? "Student submitted actor profile"
            : "Student saved actor profile",
          payload: {
            displayName,
            bio,
            portfolio,
            status: submit ? "review_requested" : "draft",
          },
        });
        void invalidateStudioDomains(queryClient, ["actorProfiles"]);
      }
      setEditing(false);
      setNotice(
        submit
          ? "Actor page submitted for coach review."
          : "Actor page draft saved.",
      );
    } catch (reason) {
      setNotice(
        reason instanceof Error ? reason.message : "Actor page save failed.",
      );
      throw reason;
    }
  };
  return (
    <div className="student-page">
      <header className="student-header">
        <h1>Actor Page</h1>
      </header>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      <Section title="Profile" marked>
        <div className="table-list">
          <article>
            <UserRound />
            <div>
              <strong>{profile.displayName}</strong>
              <small>/actors/{profile.slug}</small>
            </div>
            <Status tone={profile.status === "published" ? "good" : "warn"}>
              {profile.status.replaceAll("_", " ")}
            </Status>
            <div className="profile-actions">
              <button onClick={() => setEditing(true)}>Edit</button>
              <button onClick={() => setPreviewing(true)}>Preview draft</button>
              {profile.status === "published" && (
                <a
                  className="button-link"
                  href={`/actors/${profile.slug}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View live page
                </a>
              )}
            </div>
          </article>
        </div>
      </Section>
      <p className="section-intro">
        Upload actor-page media here. Your coach reviews it before publication.
      </p>
      <Materials data={data} isDemo={isDemo} embedded actorOnly />
      {previewing && (
        <Drawer
          title="Private actor-page preview"
          onClose={() => setPreviewing(false)}
        >
          <ActorProfilePreview
            profile={profile}
            materials={data.materials.filter(
              (item) => item.role === "actor_material",
            )}
            studioName={data.settings.studioName}
            logoUrl={data.settings.branding.logoUrl}
          />
        </Drawer>
      )}
      {editing && (
        <ActorBuilder
          profile={profile}
          onClose={() => setEditing(false)}
          onSave={(displayName, bio, portfolio, submit) =>
            save(displayName, bio, portfolio, submit)
          }
          materials={data.materials.filter(
            (item) => item.role === "actor_material",
          )}
          studioName={data.settings.studioName}
          logoUrl={data.settings.branding.logoUrl}
        />
      )}
    </div>
  );
}
