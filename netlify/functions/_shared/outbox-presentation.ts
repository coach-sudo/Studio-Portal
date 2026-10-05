import { renderStudioEmail } from "./email-presentation";
import { portalActionUrl, type PortalAction } from "./portal-url";

export interface EmailStudio {
  name: string;
  settings?: { coachName?: string; branding?: { logoUrl?: string } };
}
export function presentOutboxMessage(
  input: { body: string; event_key?: string | null; lesson_id?: string | null },
  studio: EmailStudio,
  origin: string,
  action?: { label: string; url: string },
) {
  // Old editable copy may contain the historic misspelled host. Current links are rebuilt
  // from the trusted origin, not from the old host or request headers; discard query data.
  const text = input.body.replace(
    /https:\/\/portal\.daj\.com[^\s<>]*/gi,
    (value) => {
      try {
        return new URL(new URL(value).pathname, origin).href;
      } catch {
        return origin;
      }
    },
  );
  const event = input.event_key ?? "";
  const defaultAction: PortalAction = /payment|receipt/.test(event)
    ? "payments"
    : /package/.test(event)
      ? "packages"
      : /credentials|invite|account/.test(event)
        ? "login"
        : /actor/.test(event)
          ? "actor"
          : /note|assignment|material|work/.test(event)
            ? "work"
            : "lesson";
  const labels: Record<PortalAction, string> = {
    lesson: "View Lesson",
    booking: "View / Manage Booking",
    payments: "Pay Balance",
    packages: "View Packages",
    work: /note/.test(event) ? "Read Lesson Notes" : "View Practice",
    actor: "Review Actor Page",
    login: "Sign in",
    book: "Book a Lesson",
  };
  const primary = action ?? {
    label: labels[defaultAction],
    url: portalActionUrl(origin, defaultAction, input.lesson_id ?? undefined),
  };
  // Preserve editable copy while avoiding a duplicated inline copy of the same generated CTA.
  const body = text
    .split("\n")
    .filter((line) => !line.includes(primary.url))
    .join("\n")
    .trim();
  const greeting = /^(?:Hi|Hello)[^\n]*[,:]/.exec(body)?.[0] ?? "Hello,";
  const message = body.startsWith(greeting)
    ? body.slice(greeting.length).trim()
    : body;
  return renderStudioEmail({
    greeting,
    message,
    primaryAction: primary,
    coachName: studio.settings?.coachName || "Darius",
    studioName: studio.name,
    logoUrl: studio.settings?.branding?.logoUrl,
  });
}
