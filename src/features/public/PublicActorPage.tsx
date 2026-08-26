import { ArrowLeft, FileText, Mail, MapPin, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useStudio } from "../../hooks/useStudio";
import { applyStudioBranding } from "../../lib/branding";

type ActorMaterial = {
  id: string;
  title: string;
  category: string;
  caption?: string;
  url: string;
  mime_type?: string;
  media_kind?: "image" | "video" | "audio" | "document" | "link";
};
interface PublicActor {
  studio: {
    name: string;
    branding: {
      primaryColor?: string;
      secondaryColor?: string;
      accentColor?: string;
      surfaceColor?: string;
      logoUrl?: string;
    };
    websiteUrl?: string;
  };
  displayName: string;
  bio: string;
  focusArea?: string;
  headline?: string;
  unionStatus?: string;
  location?: string;
  playingAge?: string;
  height?: string;
  eyeColor?: string;
  hairColor?: string;
  website?: string;
  representation?: string;
  accentColor?: string;
  contactEmail?: string;
  contactPhone?: string;
  showEmail?: boolean;
  showPhone?: boolean;
  primaryHeadshotMaterialId?: string;
  materials: ActorMaterial[];
}
const embedUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com")) {
      const id = parsed.searchParams.get("v");
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : url;
    }
    if (parsed.hostname === "youtu.be")
      return `https://www.youtube-nocookie.com/embed/${parsed.pathname.slice(1)}`;
    if (parsed.hostname.includes("vimeo.com"))
      return `https://player.vimeo.com/video/${parsed.pathname.split("/").filter(Boolean).at(-1)}`;
  } catch {
    return url;
  }
  return url;
};
function ActorMedia({ item }: { item: ActorMaterial }) {
  const kind =
    item.media_kind ||
    (item.mime_type?.startsWith("image/")
      ? "image"
      : item.mime_type?.startsWith("video/")
        ? "video"
        : item.mime_type?.startsWith("audio/")
          ? "audio"
          : "document");
  return (
    <article className={`actor-media-card actor-media-${kind}`}>
      {kind === "image" ? (
        <img src={item.url} alt={item.caption || item.title} />
      ) : kind === "video" ? (
        <video
          src={item.url}
          controls
          preload="metadata"
          aria-label={item.title}
        />
      ) : kind === "audio" ? (
        <audio src={item.url} controls aria-label={item.title} />
      ) : /(youtube\.com|youtu\.be|vimeo\.com)/.test(item.url) ? (
        <iframe
          src={embedUrl(item.url)}
          title={item.title}
          allow="fullscreen; picture-in-picture"
          allowFullScreen
        />
      ) : item.mime_type === "application/pdf" || /\.pdf(?:$|\?)/i.test(item.url) ? (
        <div className="actor-document-preview">
          <iframe src={`${item.url}#toolbar=0&navpanes=0`} title={`${item.title} preview`} />
          <a href={item.url} target="_blank" rel="noreferrer">
            <FileText />
            View or download résumé
          </a>
        </div>
      ) : (
        <a href={item.url} target="_blank" rel="noreferrer">
          <FileText />
          Open {item.title}
        </a>
      )}
      <div>
        <strong>{item.title}</strong>
        <small>{item.caption || item.category}</small>
      </div>
    </article>
  );
}

export function PublicActorPage() {
  const { slug = "" } = useParams(),
    { data, isDemo } = useStudio(),
    demoProfile = data?.actorProfiles.find(
      (row) => row.slug === slug && row.status === "published",
    ),
    demoStudent = data?.students.find(
      (row) => row.id === demoProfile?.studentId,
    ),
    [actor, setActor] = useState<PublicActor | undefined>(() =>
      demoProfile
        ? {
            studio: {
              name: data!.settings.studioName,
              branding: data!.settings.branding,
              websiteUrl: data!.settings.bookingPage.footerWebsiteUrl,
            },
            displayName: demoProfile.displayName,
            bio: demoProfile.bio,
            focusArea: demoStudent?.focusArea,
            ...demoProfile.draftContent,
            materials: (data?.materials || [])
              .filter(
                (row) =>
                  row.studentId === demoProfile.studentId &&
                  row.approvalStatus === "approved" &&
                  row.externalUrl,
              )
              .map((row) => ({
                id: row.id,
                title: row.title,
                category: row.category,
                url: row.externalUrl!,
                media_kind: row.mediaKind || (row.mimeType?.startsWith("image/") ? "image" : "link"),
                mime_type: row.mimeType,
              })),
          }
        : undefined,
    ),
    [loading, setLoading] = useState(!isDemo);
  useEffect(() => {
    if (isDemo) {
      setLoading(false);
      return;
    }
    fetch(`/api/v2/public/actors/${encodeURIComponent(slug)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(setActor)
      .catch(() => setActor(undefined))
      .finally(() => setLoading(false));
  }, [isDemo, slug]);
  useEffect(() => {
    if (!actor) return;
    const b = actor.studio.branding,
      root = document.documentElement;
    document.title = `${actor.displayName} — ${actor.studio.name} · Coach’D`;
    applyStudioBranding(b);
    if (actor.accentColor) root.style.setProperty("--actor-accent", actor.accentColor);
  }, [actor]);
  if (loading) return <div className="loading">Opening actor page…</div>;
  if (!actor)
    return (
      <main className="public-empty">
        <div className="wordmark">Studio Portal</div>
        <h1>Actor page unavailable</h1>
        <p>This profile is not currently published.</p>
        <Link to="/">
          <ArrowLeft />
          Studio portal
        </Link>
      </main>
    );
  const imageMaterials = actor.materials.filter((item) => item.media_kind === "image" || item.mime_type?.startsWith("image/"));
  const headshot = imageMaterials.find((item) => item.id === actor.primaryHeadshotMaterialId) || imageMaterials.find((item) => item.category.toLowerCase().includes("headshot")) || imageMaterials[0];
  const gallery = imageMaterials.filter((item) => item.id !== headshot?.id);
  const reel = actor.materials.filter((item) => item.id !== headshot?.id && (item.media_kind === "video" || /(reel|performance|clip)/i.test(item.category)));
  const documents = actor.materials.filter((item) => item.id !== headshot?.id && !gallery.some((photo) => photo.id === item.id) && !reel.some((video) => video.id === item.id));
  return (
    <main className="actor-public">
      <header className="actor-public-kicker"><span>{actor.displayName} · Actor</span></header>
      <article className="actor-public-hero">
        {headshot ? <img className="actor-headshot" src={headshot.url} alt={`${actor.displayName} headshot`} /> : <div className="actor-monogram">
          {actor.displayName
            .split(" ")
            .map((part) => part[0])
            .join("")}
        </div>}
        <div className="actor-public-intro">
          <span className="actor-eyebrow">Actor · Storyteller</span>
          <h1>{actor.displayName}</h1>
          {actor.headline && <h2>{actor.headline}</h2>}
          {(actor.showPhone || actor.showEmail) && <div className="actor-contact-actions">{actor.showPhone && actor.contactPhone && <a href={`tel:${actor.contactPhone}`}><Phone />Call</a>}{actor.showEmail && actor.contactEmail && <a href={`mailto:${actor.contactEmail}`}><Mail />Email</a>}</div>}
          <p>{actor.bio}</p>
          {actor.location && (
            <span>
              <MapPin />
              {actor.location}
            </span>
          )}
          <dl className="actor-stats">{actor.unionStatus && <div><dt>Union</dt><dd>{actor.unionStatus}</dd></div>}{actor.playingAge && <div><dt>Playing age</dt><dd>{actor.playingAge}</dd></div>}{actor.height && <div><dt>Height</dt><dd>{actor.height}</dd></div>}{actor.eyeColor && <div><dt>Eyes</dt><dd>{actor.eyeColor}</dd></div>}{actor.hairColor && <div><dt>Hair</dt><dd>{actor.hairColor}</dd></div>}{actor.representation && <div><dt>Representation</dt><dd>{actor.representation}</dd></div>}</dl>
          {actor.website && <a className="actor-website" href={actor.website} target="_blank" rel="noreferrer">Official website</a>}
        </div>
      </article>
      {gallery.length > 0 && <section className="actor-public-section"><div className="actor-section-heading"><span>01</span><h2>Gallery</h2></div><div className="actor-media-grid actor-gallery">{gallery.map((item) => <ActorMedia key={item.id} item={item} />)}</div></section>}
      {reel.length > 0 && <section className="actor-public-section actor-reel-section"><div className="actor-section-heading"><span>02</span><h2>Reel & performance</h2></div><div className="actor-media-grid">{reel.map((item) => <ActorMedia key={item.id} item={item} />)}</div></section>}
      {documents.length > 0 && <section className="actor-public-section"><div className="actor-section-heading"><span>03</span><h2>Résumé & selected work</h2></div><div className="actor-media-grid actor-documents">{documents.map((item) => <ActorMedia key={item.id} item={item} />)}</div></section>}
      {!actor.materials.length && <section><h2>Selected work</h2><p>Selected work is being prepared.</p></section>}
      <footer className="actor-footer">{actor.studio.branding.logoUrl ? <img className="booking-logo" src={actor.studio.branding.logoUrl} alt={actor.studio.name} /> : <div className="wordmark">{actor.studio.name}</div>}{actor.studio.websiteUrl && <a href={actor.studio.websiteUrl} target="_blank" rel="noreferrer">Visit {actor.studio.name}</a>}</footer>
    </main>
  );
}
