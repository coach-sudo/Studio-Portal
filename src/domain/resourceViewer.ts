import type { ResourceDetail, StudyAnchor } from "./library";

export function viewerKind(resource: ResourceDetail) {
  const mime = resource.mimeType?.split(";")[0].toLowerCase();
  if (resource.text && !resource.storagePath) return "text";
  if (!resource.storagePath)
    return resource.externalUrl ? "link" : "unavailable";
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/plain") return "text-file";
  if (
    [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/avif",
      "image/bmp",
    ].includes(mime || "")
  )
    return "image";
  if (
    [
      "audio/mpeg",
      "audio/mp4",
      "audio/ogg",
      "audio/wav",
      "audio/webm",
    ].includes(mime || "")
  )
    return "audio";
  if (["video/mp4", "video/webm", "video/ogg"].includes(mime || ""))
    return "video";
  return "unsupported";
}
export function safeResourceUrl(value?: string) {
  try {
    const url = new URL(value || "");
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function embeddedResourceUrl(value?: string) {
  const safe = safeResourceUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.protocol !== "https:") return null;
  if (
    [
      "youtube.com",
      "www.youtube.com",
      "youtu.be",
      "www.youtube-nocookie.com",
    ].includes(url.hostname)
  ) {
    const id =
      url.hostname === "youtu.be"
        ? url.pathname.slice(1)
        : url.searchParams.get("v") ||
          url.pathname.match(/^\/embed\/([\w-]+)$/)?.[1];
    return id && /^[\w-]{11}$/.test(id)
      ? `https://www.youtube-nocookie.com/embed/${id}`
      : null;
  }
  if (
    ["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(url.hostname)
  ) {
    const id = url.pathname.match(/^\/(?:video\/)?(\d+)$/)?.[1];
    return id ? `https://player.vimeo.com/video/${id}` : null;
  }
  return null;
}
export function anchorLabel(anchor: StudyAnchor) {
  if (anchor.page) return `Page ${anchor.page}`;
  if (anchor.paragraph) return `Paragraph ${anchor.paragraph}`;
  if (anchor.seconds !== undefined)
    return `${Math.floor(anchor.seconds / 60)}:${String(Math.floor(anchor.seconds % 60)).padStart(2, "0")}`;
  return "Resource";
}
