import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ResourceDetail, StudyAnchor } from "../../domain/library";
import {
  embeddedResourceUrl,
  safeResourceUrl,
  viewerKind,
} from "../../domain/resourceViewer";
import { getResourceWorkspace } from "../../data/library";
import { getSignedMaterialUrl } from "../../data/repository";

const PdfReader = lazy(() => import("./PdfReader"));

function TextReader({
  text,
  zoom,
  anchor,
  onPosition,
}: {
  text: string;
  zoom: number;
  anchor: StudyAnchor;
  onPosition: (anchor: StudyAnchor) => void;
}) {
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null),
    current = useRef(0);
  const paragraphs = text.split(/\n\s*\n/),
    found = search.trim()
      ? paragraphs.flatMap((p, i) =>
          p.toLocaleLowerCase().includes(search.toLocaleLowerCase())
            ? [i + 1]
            : [],
        )
      : [];
  const report = useRef(onPosition);
  report.current = onPosition;
  useEffect(() => {
    if (anchor.paragraph && anchor.paragraph !== current.current) {
      current.current = anchor.paragraph;
      root.current
        ?.querySelector(`[data-paragraph="${anchor.paragraph}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [anchor.paragraph]);
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        const n = Number(
          (first?.target as HTMLElement | undefined)?.dataset.paragraph,
        );
        if (n && n !== current.current) {
          current.current = n;
          report.current({ paragraph: n });
        }
      },
      { root: root.current, threshold: 0.5 },
    );
    root.current
      ?.querySelectorAll("[data-paragraph]")
      .forEach((p) => observer.observe(p));
    return () => observer.disconnect();
  }, [text]);
  return (
    <>
      <div className="viewer-toolbar">
        <label>
          Find in text
          <input
            type="search"
            value={search}
            maxLength={200}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {search && (
          <span role="status">{found.length} matching paragraphs</span>
        )}
        {found.length > 0 && (
          <button
            onClick={() =>
              onPosition({
                paragraph:
                  found.find((n) => n > (anchor.paragraph || 0)) || found[0],
              })
            }
          >
            Next match
          </button>
        )}
      </div>
      <div
        ref={root}
        className="text-reader"
        style={{ fontSize: `${zoom}em` }}
        tabIndex={0}
        aria-label="Resource text"
      >
        {paragraphs.map((p, i) => (
          <p
            key={i}
            id={`paragraph-${i + 1}`}
            data-paragraph={i + 1}
            className={found.includes(i + 1) ? "text-match" : undefined}
          >
            {p}
          </p>
        ))}
      </div>
    </>
  );
}
function MediaReader({
  url,
  kind,
  anchor,
  onPosition,
  onFailure,
}: {
  url: string;
  kind: "audio" | "video";
  anchor: StudyAnchor;
  onPosition: (a: StudyAnchor) => void;
  onFailure: () => void;
}) {
  const ref = useRef<HTMLMediaElement | null>(null),
    position = useRef(anchor),
    ready = useRef(false);
  position.current = anchor;
  useEffect(() => {
    ready.current = false;
  }, [url]);
  useEffect(() => {
    if (
      ref.current &&
      anchor.seconds !== undefined &&
      Number.isFinite(ref.current.duration) &&
      Math.abs(ref.current.currentTime - anchor.seconds) > 2
    )
      ref.current.currentTime = Math.min(anchor.seconds, ref.current.duration);
  }, [anchor.seconds]);
  const Component = kind;
  return (
    <Component
      ref={(element) => {
        ref.current = element;
      }}
      controls
      preload="metadata"
      src={url}
      aria-label={`Resource ${kind}`}
      onLoadedMetadata={(e) => {
        if (
          position.current.seconds &&
          Number.isFinite(e.currentTarget.duration)
        )
          e.currentTarget.currentTime = Math.min(
            position.current.seconds,
            e.currentTarget.duration,
          );
        ready.current = true;
      }}
      onTimeUpdate={(e) => {
        if (
          ready.current &&
          !e.currentTarget.seeking &&
          Number.isFinite(e.currentTarget.currentTime)
        )
          onPosition({ seconds: Math.floor(e.currentTarget.currentTime) });
      }}
      onSeeked={(e) => {
        if (ready.current)
          onPosition({ seconds: Math.floor(e.currentTarget.currentTime) });
      }}
      onError={onFailure}
    />
  );
}
export default function ResourceViewer({
  resource,
  studentId,
  assignmentId,
  anchor,
  onPosition,
  isDemo,
  onAccessLost,
}: {
  resource: ResourceDetail;
  studentId?: string;
  assignmentId?: string;
  anchor: StudyAnchor;
  onPosition: (a: StudyAnchor) => void;
  isDemo: boolean;
  onAccessLost?: () => void;
}) {
  const [url, setUrl] = useState<string>(),
    [error, setError] = useState(""),
    [zoom, setZoom] = useState(1),
    [text, setText] = useState(""),
    [attempt, setAttempt] = useState(0);
  const container = useRef<HTMLDivElement>(null),
    retries = useRef(0),
    kind = viewerKind(resource);
  const accessLost = useRef(onAccessLost);
  accessLost.current = onAccessLost;
  const [fullscreenError, setFullscreenError] = useState("");
  useEffect(() => {
    if (!resource.storagePath || isDemo) return;
    let alive = true;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const current = await getResourceWorkspace(
          resource.id,
          studentId,
          assignmentId,
          controller.signal,
        );
        if (
          !current ||
          current.resource.contentIdentity !== resource.contentIdentity
        ) {
          if (alive) accessLost.current?.();
          throw new Error(
            "Resource changed or access was removed. Reopen it to continue.",
          );
        }
        const signed = await getSignedMaterialUrl(resource.storagePath!, true);
        if (!alive) return;
        if (kind === "text-file") {
          const response = await fetch(signed, { signal: controller.signal });
          if (
            !response.ok ||
            Number(response.headers.get("content-length")) > 1000000
          )
            throw new Error(
              "Text could not be loaded. Open the original instead.",
            );
          const body = await response.text();
          if (body.length > 1000000)
            throw new Error("This text file is too large to preview.");
          if (alive) setText(body);
        }
        if (alive) {
          setUrl(signed);
          setError("");
        }
      } catch (reason) {
        if (alive) {
          setUrl(undefined);
          setText("");
          setError(
            reason instanceof Error ? reason.message : "Resource unavailable.",
          );
        }
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 240000);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [
    resource.id,
    resource.storagePath,
    resource.contentIdentity,
    studentId,
    assignmentId,
    kind,
    isDemo,
    attempt,
  ]);
  const failed = () => {
    if (retries.current++ < 1) setAttempt((n) => n + 1);
    else {
      setError("Preview unavailable. Retry access or open the original.");
    }
  };
  const external = safeResourceUrl(resource.externalUrl),
    embed = embeddedResourceUrl(resource.externalUrl);
  const fullscreen = async () => {
    try {
      await container.current?.requestFullscreen();
    } catch {
      setFullscreenError("Fullscreen is unavailable in this browser.");
    }
  };
  return (
    <div className="resource-viewer" ref={container}>
      <div className="viewer-toolbar" role="group" aria-label="Viewer controls">
        {["pdf", "image", "text", "text-file"].includes(kind) && (
          <>
            <button
              onClick={() => setZoom((n) => Math.max(0.75, n - 0.25))}
              disabled={zoom <= 0.75}
              aria-label="Zoom out"
            >
              −
            </button>
            <span aria-live="polite">{Math.round(zoom * 100)}%</span>
            <button
              onClick={() => setZoom((n) => Math.min(3, n + 0.25))}
              disabled={zoom >= 3}
              aria-label="Zoom in"
            >
              +
            </button>
          </>
        )}
        <button onClick={() => void fullscreen()}>Fullscreen</button>
        {(url || external) && (
          <a href={url || external!} target="_blank" rel="noopener noreferrer">
            {resource.storagePath ? "Open original" : "Open source"}
          </a>
        )}
      </div>
      {fullscreenError && <p role="status">{fullscreenError}</p>}
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button
            onClick={() => {
              retries.current = 0;
              setError("");
              setAttempt((n) => n + 1);
            }}
          >
            Retry access
          </button>
        </div>
      ) : resource.storagePath && !url && !isDemo ? (
        <p role="status">Opening secure resource…</p>
      ) : null}
      {!error && (
        <>
          {kind === "text" && (
            <TextReader
              text={resource.text}
              anchor={anchor}
              zoom={zoom}
              onPosition={onPosition}
            />
          )}
          {kind === "text-file" && url && (
            <TextReader
              text={text}
              anchor={anchor}
              zoom={zoom}
              onPosition={onPosition}
            />
          )}
          {kind === "pdf" && url && (
            <Suspense fallback={<p role="status">Loading PDF reader…</p>}>
              <PdfReader
                url={url}
                anchor={anchor}
                zoom={zoom}
                onPosition={onPosition}
                onFailure={failed}
              />
            </Suspense>
          )}
          {kind === "image" && url && (
            <div className="image-reader">
              <img
                src={url}
                alt={resource.title}
                style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
                onError={failed}
              />
            </div>
          )}
          {(kind === "audio" || kind === "video") && url && (
            <MediaReader
              url={url}
              kind={kind}
              anchor={anchor}
              onPosition={onPosition}
              onFailure={failed}
            />
          )}
          {kind === "link" &&
            (embed ? (
              <iframe
                src={embed}
                title={resource.title}
                sandbox="allow-scripts allow-same-origin allow-presentation"
                referrerPolicy="no-referrer"
                allowFullScreen
              />
            ) : (
              <p>Use Open source to view this resource.</p>
            ))}
          {(kind === "unsupported" || kind === "unavailable") && (
            <p>
              A preview is unavailable for this resource.
              {url ? " You can open the original." : ""}
            </p>
          )}
          {isDemo && resource.storagePath && (
            <p>File previews require an authenticated resource.</p>
          )}
        </>
      )}
    </div>
  );
}
