import type { ActorProfile, Material } from "../domain/model";
import { ActorPageContent } from "./ActorPageRenderer";
import "./ActorProfilePreview.css";
export function ActorProfilePreview({
  profile,
  materials,
  studioName,
  logoUrl,
}: {
  profile: ActorProfile;
  materials: Material[];
  studioName: string;
  logoUrl?: string;
}) {
  return (
    <div className="actor-draft-preview">
      <p className="actor-preview-notice">
        Private preview · the saved published revision stays unchanged
      </p>
      <ActorPageContent
        preview
        actor={{
          studio: { name: studioName, branding: { logoUrl } },
          displayName: profile.displayName,
          bio: profile.bio,
          ...profile.draftContent,
          materials: materials
            .filter(
              (m) =>
                m.approvalStatus === "approved" &&
                m.publicEmbed &&
                m.externalUrl,
            )
            .map((m) => ({
              id: m.id,
              title: m.title,
              category: m.category,
              caption: m.caption,
              url: m.externalUrl!,
              mime_type: m.mimeType,
              media_kind: m.mediaKind,
            })),
        }}
      />
    </div>
  );
}
