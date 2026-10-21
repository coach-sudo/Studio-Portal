import { useState, useRef, type FormEvent } from "react";
import { WritingArea } from "./WritingArea";
import { Drawer } from "./Primitives";
import { ActorProfilePreview } from "./ActorProfilePreview";
import {
  readActorLayout,
  moveActorSection,
  type ActorSectionId,
} from "../domain/actorLayout";
import { useUnsavedWorkspaceChanges } from "../hooks/useWorkspaceLocation";
import type { StudioSnapshot as Snapshot, ActorProfile } from "../domain/model";
type ActorPortfolioDraft = NonNullable<ActorProfile["draftContent"]>;
import "../features/student/ActorBuilder.css";
export function ActorBuilder({
  profile,
  onClose,
  onSave,
  materials,
  studioName,
  logoUrl,
}: {
  profile: Snapshot["actorProfiles"][number];
  onClose: () => void;
  onSave: (
    name: string,
    bio: string,
    portfolio: ActorPortfolioDraft,
    submit: boolean,
  ) => Promise<void>;
  materials: Snapshot["materials"];
  studioName: string;
  logoUrl?: string;
}) {
  const [name, setName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [portfolio, setPortfolio] = useState({
    presentation: readActorLayout(profile.draftContent?.presentation),
    credits: profile.draftContent?.credits || "",
    skills: profile.draftContent?.skills || "",
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
  const [editorView, setEditorView] = useState<"edit" | "preview">("edit");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const initial = useRef(JSON.stringify({ name, bio, portfolio }));
  const changed = initial.current !== JSON.stringify({ name, bio, portfolio });
  const confirmDiscard = useUnsavedWorkspaceChanges(changed);
  const close = () => {
    if (!busy && confirmDiscard()) onClose();
  };
  const move = (id: ActorSectionId, to: number) =>
    setPortfolio((p) => ({
      ...p,
      presentation: {
        ...p.presentation,
        sections: moveActorSection(p.presentation.sections, id, to),
      },
    }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave(name, bio, portfolio, submit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Draft could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      title="Build actor page"
      className="actor-builder-dialog"
      onClose={close}
    >
      <div className="actor-builder-layout" data-editor-view={editorView}>
        <nav
          className="actor-builder-mobile-tabs"
          aria-label="Actor builder view"
        >
          <button
            type="button"
            aria-pressed={editorView === "edit"}
            onClick={() => setEditorView("edit")}
          >
            Edit content
          </button>
          <button
            type="button"
            aria-pressed={editorView === "preview"}
            onClick={() => setEditorView("preview")}
          >
            Preview page
          </button>
        </nav>
        <form className="workflow-form" onSubmit={(e) => void save(e)}>
          {error && (
            <p role="alert" className="full form-error">
              {error}
            </p>
          )}
          <label className="full">
            Layout
            <select
              value={portfolio.presentation.layout}
              onChange={(e) =>
                setPortfolio({
                  ...portfolio,
                  presentation: {
                    ...portfolio.presentation,
                    layout: e.target.value as "classic" | "spotlight",
                  },
                })
              }
            >
              <option value="classic">Classic</option>
              <option value="spotlight">Spotlight</option>
            </select>
          </label>
          <fieldset className="full actor-section-order">
            <legend>Page sections</legend>
            <p>
              Identity and studio attribution stay fixed. Only approved, public
              media appears in the preview.
            </p>
            {portfolio.presentation.sections.map((id, index) => (
              <div
                key={id}
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData("application/x-actor-section", id)
                }
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = e.dataTransfer.getData(
                    "application/x-actor-section",
                  ) as ActorSectionId;
                  if (portfolio.presentation.sections.includes(from))
                    move(from, index);
                }}
              >
                <strong>{id}</strong>
                <button
                  type="button"
                  disabled={index === 0}
                  aria-label={`Move ${id} up`}
                  onClick={() => move(id, index - 1)}
                >
                  Move up
                </button>
                <button
                  type="button"
                  disabled={index === 4}
                  aria-label={`Move ${id} down`}
                  onClick={() => move(id, index + 1)}
                >
                  Move down
                </button>
              </div>
            ))}
          </fieldset>
          <h3 className="full actor-form-section">Identity</h3>
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
          <h3 className="full actor-form-section">Professional details</h3>
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
                setPortfolio({
                  ...portfolio,
                  representation: event.target.value,
                })
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
          <h3 className="full actor-form-section">Public contact</h3>
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
              {materials
                .filter(
                  (m) =>
                    m.approvalStatus === "approved" &&
                    m.publicEmbed &&
                    (m.mediaKind === "image" ||
                      m.mimeType?.startsWith("image/")),
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
            </select>
            <small>All other approved photos appear in the gallery.</small>
          </label>
          <h3 className="full actor-form-section">Biography & review</h3>
          <label className="full">
            Bio
            <WritingArea
              writingSize="long"
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
            <small>Your coach must approve changes before publication.</small>
          </label>
          <label className="full">
            Résumé / credits
            <WritingArea
              writingSize="long"
              value={portfolio.credits}
              onChange={(e) =>
                setPortfolio({ ...portfolio, credits: e.target.value })
              }
            />
          </label>
          <label className="full">
            Skills
            <WritingArea
              value={portfolio.skills}
              onChange={(e) =>
                setPortfolio({ ...portfolio, skills: e.target.value })
              }
            />
          </label>
          <div className="form-actions">
            <button type="button" disabled={busy} onClick={close}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save draft"}
            </button>
          </div>
        </form>
        <aside className="actor-builder-preview">
          <div className="form-actions">
            <button
              aria-pressed={viewport === "desktop"}
              onClick={() => setViewport("desktop")}
            >
              Desktop preview
            </button>
            <button
              aria-pressed={viewport === "mobile"}
              onClick={() => setViewport("mobile")}
            >
              Mobile preview
            </button>
          </div>
          <div className={`actor-builder-viewport ${viewport}`}>
            <ActorProfilePreview
              profile={{
                ...profile,
                displayName: name,
                bio,
                draftContent: portfolio,
              }}
              materials={materials}
              studioName={studioName}
              logoUrl={logoUrl}
            />
          </div>
        </aside>
      </div>
    </Drawer>
  );
}
