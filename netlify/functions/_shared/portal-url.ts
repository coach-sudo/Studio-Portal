import { releaseMetadata } from "./release";

export interface PortalDeployment {
  context: string;
  deployPrimeUrl?: string;
  deployUrl?: string;
  siteUrl?: string;
  ephemeral?: boolean;
  testUrl?: string;
}
const productionOrigin = "https://portal.d-a-j.com";

/** Only trusted deployment metadata is accepted. Never read a request Origin/header. */
export function resolvePortalOrigin(deployment: PortalDeployment): string {
  if (deployment.context === "production") return productionOrigin;
  const configured = deployment.ephemeral
    ? deployment.testUrl
    : deployment.deployPrimeUrl || deployment.deployUrl || deployment.siteUrl;
  if (!configured)
    throw new Error(
      "PROVIDER_UNAVAILABLE: A trusted portal URL is not configured for this deployment.",
    );
  const url = new URL(configured);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(deployment.ephemeral && loopback && url.protocol === "http:"))
  )
    throw new Error("PROVIDER_UNAVAILABLE: The trusted portal URL is invalid.");
  if (
    [
      "portal.d-a-j.com",
      "portal.daj.com",
      "studio-portal.netlify.app",
    ].includes(url.hostname)
  )
    throw new Error(
      "PROVIDER_UNAVAILABLE: A non-production deployment must use its own portal URL.",
    );
  return url.origin;
}

export function portalOrigin() {
  return resolvePortalOrigin({
    context: releaseMetadata().context,
    deployPrimeUrl: Netlify.env.get("DEPLOY_PRIME_URL"),
    deployUrl: Netlify.env.get("DEPLOY_URL"),
    siteUrl: Netlify.env.get("URL"),
    ephemeral: Netlify.env.get("E2E_EPHEMERAL") === "true",
    testUrl: Netlify.env.get("STAGING_BASE_URL"),
  });
}

export type PortalAction =
  | "lesson"
  | "booking"
  | "payments"
  | "packages"
  | "work"
  | "actor"
  | "login"
  | "book";
export function portalActionUrl(
  origin: string,
  action: PortalAction,
  entityId?: string,
) {
  const paths: Record<PortalAction, string> = {
    lesson: entityId
      ? `/portal/lessons/${encodeURIComponent(entityId)}`
      : "/portal/bookings",
    booking: entityId
      ? `/booking/${encodeURIComponent(entityId)}`
      : "/portal/bookings",
    payments: "/portal/payments",
    packages: "/portal/payments",
    work: "/portal/work",
    actor: "/portal/actor-page",
    login: "/login",
    book: "/book",
  };
  return new URL(paths[action], origin).href;
}
