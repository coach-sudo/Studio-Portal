export interface EmailPresentation {
  greeting: string;
  heading?: string;
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
  const link = (label: string, url: string, button = false) =>
    `<a href="${escape(url)}" style="${button ? "display:inline-block;padding:14px 22px;background:#173f35;color:#ffffff;border-radius:8px;text-decoration:none;" : "color:#173f35;"}font-weight:600;line-height:1.5;overflow-wrap:anywhere">${escape(label)}</a>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(input.heading || input.studioName)}</title></head><body style="margin:0;background:#f3f6f8;color:#23312d;font-family:Arial,sans-serif;font-size:16px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;table-layout:fixed"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e2e8ec;border-radius:12px"><tr><td style="padding:28px 24px;overflow-wrap:anywhere;word-break:break-word"><main>${input.heading ? `<h1 style="margin:0 0 24px;font-size:24px;line-height:1.3;color:#173f35">${escape(input.heading)}</h1>` : ""}${paragraph(input.greeting)}${input.message
    .split(/\n\s*\n/)
    .map(paragraph)
    .join(
      "",
    )}${input.summary ? `<div style="padding:16px;margin:0 0 24px;background:#f3f6f8;border-radius:8px">${paragraph(input.summary)}</div>` : ""}${primary ? `<p style="margin:24px 0 28px">${link(input.primaryAction!.label, primary, true)}</p>` : ""}${secondary ? `<p style="margin:0 0 24px">${link(input.secondaryAction!.label, secondary)}</p>` : ""}${paragraph(input.coachName)}<footer style="border-top:1px solid #e2e8ec;padding-top:20px;color:#53645e;font-size:14px">${paragraph(input.studioName)}${logo ? `<img src="${escape(logo)}" alt="${escape(input.studioName)} logo" width="120" style="display:block;max-width:120px;height:auto">` : ""}</footer></main></td></tr></table></td></tr></table></body></html>`;
  return { text: lines.join("\n\n"), html };
}
