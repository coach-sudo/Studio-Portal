import { FileText, Mail, MapPin, Phone } from "lucide-react";
import type { ActorProfile, Material } from "../domain/model";

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
  const portfolio = profile.draftContent || {};
  const images = materials.filter(
    (item) => item.externalUrl && (item.mediaKind === "image" || item.mimeType?.startsWith("image/")),
  );
  const headshot =
    images.find((item) => item.id === portfolio.primaryHeadshotMaterialId) ||
    images.find((item) => /headshot/i.test(item.category)) ||
    images[0];
  const gallery = images.filter((item) => item.id !== headshot?.id);
  const otherMaterials = materials.filter(
    (item) => item.externalUrl && !images.some((image) => image.id === item.id),
  );
  const initials = profile.displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);

  return (
    <article
      className="actor-draft-preview"
      style={
        portfolio.accentColor
          ? ({ "--actor-preview-accent": portfolio.accentColor } as React.CSSProperties)
          : undefined
      }
    >
      <p className="actor-preview-notice">
        Private preview · only the saved published version is public
      </p>
      <section className="actor-preview-hero">
        {headshot?.externalUrl ? (
          <img src={headshot.externalUrl} alt={`${profile.displayName} headshot preview`} />
        ) : (
          <div className="actor-preview-monogram" aria-label="No headshot selected">
            {initials}
          </div>
        )}
        <div>
          <span>Actor · Storyteller</span>
          <h2>{profile.displayName}</h2>
          {portfolio.headline && <h3>{portfolio.headline}</h3>}
          {(portfolio.showPhone || portfolio.showEmail) && (
            <div className="actor-preview-contact">
              {portfolio.showPhone && portfolio.contactPhone && (
                <span>
                  <Phone /> Call
                </span>
              )}
              {portfolio.showEmail && portfolio.contactEmail && (
                <span>
                  <Mail /> Email
                </span>
              )}
            </div>
          )}
          <p>{profile.bio || "Add a bio to introduce the actor and their work."}</p>
          {portfolio.location && (
            <small>
              <MapPin /> {portfolio.location}
            </small>
          )}
          <dl>
            {portfolio.unionStatus && <div><dt>Union</dt><dd>{portfolio.unionStatus}</dd></div>}
            {portfolio.playingAge && <div><dt>Playing age</dt><dd>{portfolio.playingAge}</dd></div>}
            {portfolio.height && <div><dt>Height</dt><dd>{portfolio.height}</dd></div>}
            {portfolio.eyeColor && <div><dt>Eyes</dt><dd>{portfolio.eyeColor}</dd></div>}
            {portfolio.hairColor && <div><dt>Hair</dt><dd>{portfolio.hairColor}</dd></div>}
            {portfolio.representation && <div><dt>Representation</dt><dd>{portfolio.representation}</dd></div>}
          </dl>
        </div>
      </section>
      {gallery.length > 0 && (
        <section className="actor-preview-section">
          <h3>Gallery</h3>
          <div className="actor-preview-gallery">
            {gallery.map((item) => (
              <figure key={item.id}>
                <img src={item.externalUrl} alt={item.caption || item.title} />
                <figcaption>{item.caption || item.title}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
      {otherMaterials.length > 0 && (
        <section className="actor-preview-section">
          <h3>Reel, résumé & selected work</h3>
          <div className="actor-preview-links">
            {otherMaterials.map((item) => (
              <a key={item.id} href={item.externalUrl} target="_blank" rel="noreferrer">
                <FileText />
                <span><strong>{item.title}</strong><small>{item.caption || item.category}</small></span>
              </a>
            ))}
          </div>
        </section>
      )}
      {!materials.some((item) => item.externalUrl) && (
        <p className="actor-preview-empty">Add a headshot, reel, or résumé to see it in this preview.</p>
      )}
      <footer>
        {logoUrl && <img src={logoUrl} alt="" />}
        <span>{studioName}</span>
      </footer>
    </article>
  );
}
