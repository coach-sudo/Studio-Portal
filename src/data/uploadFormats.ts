export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const typesByExtension: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  fdx: "application/octet-stream",
  fountain: "text/plain",
  pages: "application/vnd.apple.pages",
  zip: "application/zip",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  avif: "image/avif",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

const allowedTypes = new Set([
  ...Object.values(typesByExtension),
  "audio/webm",
  "video/ogg",
]);
export const studioFileAccept = [
  ...Object.keys(typesByExtension).map((extension) => "." + extension),
  "audio/webm",
  "video/ogg",
].join(",");

export function studioDownloadName(title: string, mime?: string) {
  const clean = title.replace(/[\\/:*?"<>|]/g, "-").trim() || "material";
  const extension = clean.split(".").pop()?.toLowerCase();
  if (
    extension &&
    extension !== clean.toLowerCase() &&
    Object.hasOwn(typesByExtension, extension)
  )
    return clean;
  const format = Object.entries(typesByExtension).find(
    ([, type]) => type === mime,
  );
  return format ? clean + "." + format[0] : clean;
}

export function studioFileType(file: File) {
  if (file.size < 1 || file.size > MAX_FILE_BYTES)
    throw new Error("Choose a non-empty file of 50 MB or less.");
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const knownMime = file.type.split(";")[0].toLowerCase();
  const mime = Object.hasOwn(typesByExtension, extension)
    ? extension === "webm" && knownMime === "audio/webm"
      ? knownMime
      : typesByExtension[extension]
    : knownMime;
  if (
    !allowedTypes.has(mime) ||
    (mime === "application/octet-stream" && extension !== "fdx")
  )
    throw new Error(
      "Choose a supported document, image, audio, video, or ZIP file.",
    );
  return mime;
}
