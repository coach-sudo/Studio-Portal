/** Signed URLs are a render-time capability, never the identity of an uploaded asset. */
export function settingsWriteValues(value: object, base = false) {
  const copy = JSON.parse(
    JSON.stringify(value, (_key, v) => (v === undefined ? null : v)),
  ) as Record<string, any>;
  for (const [section, pairs] of [
    [
      "branding",
      [
        ["logoStoragePath", "logoUrl"],
        ["coachProfilePhotoStoragePath", "coachProfilePhotoUrl"],
      ],
    ],
    ["dailyPopup", [["backgroundImageStoragePath", "backgroundImageUrl"]]],
  ] as const) {
    for (const [path, url] of pairs)
      if (copy[section]?.[path]) {
        // Ignore resolved URLs when checking concurrent edits; retire old persisted tokens on save.
        if (base) delete copy[section][url];
        else copy[section][url] = section === "dailyPopup" ? "" : null;
      }
  }
  return copy;
}

export function validateStudioImage(file: File) {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size < 1 ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error(
      "Choose a PNG, JPEG or WebP image between 1 byte and 5 MB.",
    );
}
