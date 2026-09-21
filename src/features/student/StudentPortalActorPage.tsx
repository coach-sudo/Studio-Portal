import { useQueryClient } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { ActorProfilePreview } from "../../components/ActorProfilePreview";
import "../../components/IdentityActions.css";
import { Dialog, Section, Status } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import {
  type ActorPortfolioDraft,
  type Snapshot,
} from "./StudentPortal.shared";

import { PortalList } from "./StudentPortalList";
import { Materials } from "./StudentPortalWorkContent";

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
          item.status = submit ? "review_requested" : "draft";
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
    }
  };
  return (
    <div className="student-page">
      <header className="student-header">
        <h1>Actor Page</h1>
        <p>Edit a draft and submit it for coach review before publishing.</p>
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
              <small>
                /actors/{profile.slug} · {profile.bio}
              </small>
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
        Actor-page uploads live here—not in Current Work. Your coach reviews
        each headshot, gallery image, reel, performance clip, and PDF résumé
        before it appears publicly.
      </p>
      <Materials data={data} isDemo={isDemo} embedded actorOnly />
      {previewing && (
        <Dialog
          title="Private actor-page preview"
          description="Preview the current draft before sending it for review."
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
        </Dialog>
      )}
      {editing && (
        <ActorDialog
          profile={profile}
          onClose={() => setEditing(false)}
          onSave={(displayName, bio, portfolio, submit) =>
            void save(displayName, bio, portfolio, submit)
          }
          materials={data.materials.filter(
            (item) =>
              item.role === "actor_material" && item.mediaKind === "image",
          )}
        />
      )}
    </div>
  );
}
function ActorDialog({
  profile,
  onClose,
  onSave,
  materials,
}: {
  profile: Snapshot["actorProfiles"][number];
  onClose: () => void;
  onSave: (
    name: string,
    bio: string,
    portfolio: ActorPortfolioDraft,
    submit: boolean,
  ) => void;
  materials: Snapshot["materials"];
}) {
  const [name, setName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [portfolio, setPortfolio] = useState({
    profileLabel: profile.draftContent?.profileLabel || "",
    headline: profile.draftContent?.headline || "",
    unionStatus: profile.draftContent?.unionStatus || "Non-union",
    location: profile.draftContent?.location || "",
    playingAge: profile.draftContent?.playingAge || "",
    height: profile.draftContent?.height || "",
    eyeColor: profile.draftContent?.eyeColor || "",
    hairColor: profile.draftContent?.hairColor || "",
    website: profile.draftContent?.website || "",
    representation: profile.draftContent?.representation || "",
    accentColor: profile.draftContent?.accentColor || "#c46b56",
    contactEmail: profile.draftContent?.contactEmail || "",
    contactPhone: profile.draftContent?.contactPhone || "",
    showEmail: Boolean(profile.draftContent?.showEmail),
    showPhone: Boolean(profile.draftContent?.showPhone),
    primaryHeadshotMaterialId:
      profile.draftContent?.primaryHeadshotMaterialId || "",
  });
  const [submit, setSubmit] = useState(false);
  const save = (event: FormEvent) => {
    event.preventDefault();
    onSave(name, bio, portfolio, submit);
  };
  return (
    <Dialog title="Edit actor profile" onClose={onClose}>
      <form className="workflow-form" onSubmit={save}>
        <label className="full">
          Display name
          <input
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="full">
          Short header label
          <input
            value={portfolio.profileLabel}
            onChange={(event) =>
              setPortfolio({ ...portfolio, profileLabel: event.target.value })
            }
            maxLength={80}
            placeholder="Optional — e.g. Actor · Voice artist"
          />
          <small>Leave blank to show no label above your name.</small>
        </label>
        <label className="full">
          Professional headline
          <input
            value={portfolio.headline}
            onChange={(event) =>
              setPortfolio({ ...portfolio, headline: event.target.value })
            }
            placeholder="Actor · Singer · Teaching artist"
          />
        </label>
        <label>
          Union status
          <select
            value={portfolio.unionStatus}
            onChange={(event) =>
              setPortfolio({ ...portfolio, unionStatus: event.target.value })
            }
          >
            <option>Non-union</option>
            <option>SAG-AFTRA Eligible</option>
            <option>SAG-AFTRA</option>
            <option>AEA Candidate</option>
            <option>AEA</option>
            <option>Other</option>
          </select>
        </label>
        <label>
          Base location
          <input
            value={portfolio.location}
            onChange={(event) =>
              setPortfolio({ ...portfolio, location: event.target.value })
            }
            placeholder="New York, NY"
          />
        </label>
        <label>
          Playing age
          <input
            value={portfolio.playingAge}
            onChange={(event) =>
              setPortfolio({ ...portfolio, playingAge: event.target.value })
            }
            placeholder="18–25"
          />
        </label>
        <label>
          Height
          <input
            value={portfolio.height}
            onChange={(event) =>
              setPortfolio({ ...portfolio, height: event.target.value })
            }
            placeholder={`5' 8\"`}
          />
        </label>
        <label>
          Eye color
          <input
            value={portfolio.eyeColor}
            onChange={(event) =>
              setPortfolio({ ...portfolio, eyeColor: event.target.value })
            }
          />
        </label>
        <label>
          Hair color
          <input
            value={portfolio.hairColor}
            onChange={(event) =>
              setPortfolio({ ...portfolio, hairColor: event.target.value })
            }
          />
        </label>
        <label>
          Representation
          <input
            value={portfolio.representation}
            onChange={(event) =>
              setPortfolio({ ...portfolio, representation: event.target.value })
            }
          />
        </label>
        <label>
          Personal accent color
          <input
            type="color"
            value={portfolio.accentColor}
            onChange={(event) =>
              setPortfolio({ ...portfolio, accentColor: event.target.value })
            }
          />
        </label>
        <label className="full">
          Professional website
          <input
            type="url"
            value={portfolio.website}
            onChange={(event) =>
              setPortfolio({ ...portfolio, website: event.target.value })
            }
            placeholder="https://…"
          />
        </label>
        <label>
          Public email
          <input
            type="email"
            value={portfolio.contactEmail}
            onChange={(event) =>
              setPortfolio({ ...portfolio, contactEmail: event.target.value })
            }
          />
        </label>
        <label>
          Public phone
          <input
            type="tel"
            value={portfolio.contactPhone}
            onChange={(event) =>
              setPortfolio({ ...portfolio, contactPhone: event.target.value })
            }
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={portfolio.showEmail}
            onChange={(event) =>
              setPortfolio({ ...portfolio, showEmail: event.target.checked })
            }
          />
          Show Email button
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={portfolio.showPhone}
            onChange={(event) =>
              setPortfolio({ ...portfolio, showPhone: event.target.checked })
            }
          />
          Show Call button
        </label>
        <label className="full">
          Main headshot
          <select
            value={portfolio.primaryHeadshotMaterialId}
            onChange={(event) =>
              setPortfolio({
                ...portfolio,
                primaryHeadshotMaterialId: event.target.value,
              })
            }
          >
            <option value="">Use first approved headshot</option>
            {materials.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <small>All other approved photos appear in the gallery.</small>
        </label>
        <label className="full">
          Bio
          <textarea
            required
            value={bio}
            onChange={(event) => setBio(event.target.value)}
          />
        </label>
        <label className="check-row full">
          <input
            type="checkbox"
            checked={submit}
            onChange={(event) => setSubmit(event.target.checked)}
          />
          Submit for coach review
        </label>
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Save</button>
        </div>
      </form>
    </Dialog>
  );
}
