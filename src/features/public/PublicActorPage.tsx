import {
  ActorPageContent,
  type PublicActor,
} from "../../components/ActorPageRenderer";
import "../../styles/public.css";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useStudioRoute } from "../../hooks/useStudio";
import { isDemoMode, isSupabaseConfigured } from "../../lib/supabase";
import "./PublicActorPage.css";

export function PublicActorPage() {
  const { slug = "" } = useParams();
  return isDemoMode && !isSupabaseConfigured ? (
    <DemoActorPage slug={slug} />
  ) : (
    <LiveActorPage slug={slug} />
  );
}

function DemoActorPage({ slug }: { slug: string }) {
  const { data } = useStudioRoute("coach", undefined, [
    "identity",
    "students",
    "actorProfiles",
    "work",
  ]);
  const profile = data?.actorProfiles.find(
    (row) => row.slug === slug && row.status === "published",
  );
  const student = data?.students.find((row) => row.id === profile?.studentId);
  const actor: PublicActor | undefined =
    profile && data
      ? {
          studio: {
            name: data.settings.studioName,
            branding: data.settings.branding,
            websiteUrl: data.settings.bookingPage.footerWebsiteUrl,
            actorCta: data.settings.actorPageCta,
          },
          displayName: profile.displayName,
          bio: profile.bio,
          focusArea: student?.focusArea,
          ...profile.draftContent,
          materials: data.materials
            .filter(
              (row) =>
                row.studentId === profile.studentId &&
                row.approvalStatus === "approved" &&
                row.externalUrl,
            )
            .map((row) => ({
              id: row.id,
              title: row.title,
              category: row.category,
              url: row.externalUrl!,
              media_kind:
                row.mediaKind ||
                (row.mimeType?.startsWith("image/") ? "image" : "link"),
              mime_type: row.mimeType,
            })),
        }
      : undefined;
  return <ActorPageContent actor={actor} loading={false} />;
}

function LiveActorPage({ slug }: { slug: string }) {
  const [actor, setActor] = useState<PublicActor>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/v2/public/actors/${encodeURIComponent(slug)}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((result: PublicActor) => {
        if (!controller.signal.aborted) setActor(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setActor(undefined);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug]);
  return <ActorPageContent actor={actor} loading={loading} />;
}
