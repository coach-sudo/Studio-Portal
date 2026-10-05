export interface EmailPresentation {
  greeting: string;
  message: string;
  summary?: string;
  primaryAction?: { label: string; url: string };
  secondaryAction?: { label: string; url: string };
  coachName: string;
  studioName: string;
  logoUrl?: string;
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
function safeUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.username || url.password) return undefined;
    if (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      return url.href;
  } catch {
    /* Omit unsafe/malformed assets, keeping the message usable without images. */
  }
  return undefined;
}

/** One accessible CTA, meaningful text alternative, escaped content, and bottom-only branding. */
export function renderStudioEmail(input: EmailPresentation) {
  const primary = input.primaryAction && safeUrl(input.primaryAction.url);
  const secondary = input.secondaryAction && safeUrl(input.secondaryAction.url);
  const logo = safeUrl(input.logoUrl);
  const lines = [
    input.greeting,
    input.message,
    input.summary,
    primary && `${input.primaryAction!.label}: ${primary}`,
    secondary && `${input.secondaryAction!.label}: ${secondary}`,
    input.coachName,
    input.studioName,
  ].filter(Boolean);
  const paragraph = (text: string) =>
    `<p style="margin:0 0 20px;line-height:1.6">${escape(text).replace(/\n/g, "<br>")}</p>`;
  const link = (label: string, url: string) =>
    `<a href="${escape(url)}" style="color:#173f35;font-weight:600">${escape(label)}</a>`;
  const html = `<html lang="en"><body style="margin:0;background:#f7f3ea;color:#23312d;font-family:Arial,sans-serif;font-size:16px"><main style="max-width:560px;margin:24px auto;padding:24px;background:white">${paragraph(input.greeting)}${paragraph(input.message)}${input.summary ? paragraph(input.summary) : ""}${primary ? `<p style="margin:24px 0">${link(input.primaryAction!.label, primary)}</p>` : ""}${secondary ? `<p>${link(input.secondaryAction!.label, secondary)}</p>` : ""}${paragraph(input.coachName)}<footer style="border-top:1px solid #ddd;padding-top:20px">${paragraph(input.studioName)}${logo ? `<img src="${escape(logo)}" alt="${escape(input.studioName)} logo" width="120" style="display:block;max-width:120px;height:auto">` : ""}</footer></main></body></html>`;
  return { text: lines.join("\n\n"), html };
}
