const original = "if (isFunction(true, url)) {";
const patched = "if (isFunction(true, url) || url.startsWith('/api/')) {";

/** Pinned CLI-only workaround: never retry an API authorization denial as HTML. */
export function patchNetlifyDevApiResponses(source: string): string {
  if (source.includes(patched)) return source;
  if (source.split(original).length !== 2)
    throw new Error(
      "Unsupported Netlify CLI proxy source; API guard was not applied.",
    );
  return source.replace(original, patched);
}
