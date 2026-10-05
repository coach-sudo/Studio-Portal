import { renderStudioEmail } from "./email-presentation";
import { portalActionUrl, type PortalAction } from "./portal-url";

export interface EmailStudio {
  name: string;
  settings?: {
    coachName?: string;
    branding?: { logoUrl?: string; logoStoragePath?: string };
  };
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
  // Preserve established token-scoped booking management links from legacy plain-text rows.
  // Only this trusted origin and exact token route are accepted; strip query/hash data.
  const bookingLink = /booking\.confirmed/.test(event)
    ? text
        .match(/https?:\/\/[^\s<>]+/g)
        ?.map((value) => {
          try {
            const url = new URL(value);
            return url.origin === origin &&
              /^\/booking\/[A-Za-z0-9_-]+$/.test(url.pathname)
              ? `${origin}${url.pathname}`
              : undefined;
          } catch {
            return undefined;
          }
        })
        .find(Boolean)
    : undefined;
  const primary =
    action ??
    (bookingLink
      ? { label: "View / Manage Booking", url: bookingLink }
      : {
          label: labels[defaultAction],
          url: portalActionUrl(
            origin,
            defaultAction,
            input.lesson_id ?? undefined,
          ),
        });
  // Preserve editable copy while avoiding a duplicated inline copy of the same generated CTA.
  const footer = `${studio.settings?.coachName || "Darius"}\n\n${studio.name}`;
  const withoutFooter = text.trim().endsWith(footer)
    ? text.trim().slice(0, -footer.length).trim()
    : text;
  const body = withoutFooter
    .split("\n")
    .filter((line) => {
      // Remove a standalone CTA only; retain authored sentences containing the URL.
      const clean = line.trim();
      const index = clean.indexOf(primary.url);
      if (index < 0) return true;
      const prefix = clean.slice(0, index).trim();
      const suffix = clean.slice(index + primary.url.length).trim();
      const standalone = !prefix || /^[A-Za-z /]{1,60}:$/.test(prefix);
      return !standalone || Boolean(suffix && !/^[?#]\S*$/.test(suffix));
    })
    .join("\n")
    .trim();
  const greeting = /^(?:Hi|Hello)[^\n]*[,:]/.exec(body)?.[0] ?? "Hello,";
  const message = body.startsWith(greeting)
    ? body.slice(greeting.length).trim()
    : body;
  return renderStudioEmail({
    greeting,
    heading: /payment[._](?:due|past_due)|automation\.payment/.test(event)
      ? "Payment reminder"
      : /reminder/.test(event)
        ? "Upcoming lesson reminder"
        : /confirmed/.test(event)
          ? "Booking confirmed"
          : /note/.test(event)
            ? "Your lesson notes"
            : undefined,
    message,
    primaryAction: primary,
    coachName: studio.settings?.coachName || "Darius",
    studioName: studio.name,
    logoUrl: studio.settings?.branding?.logoUrl,
  });
}
