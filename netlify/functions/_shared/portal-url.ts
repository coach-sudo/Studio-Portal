import { releaseMetadata } from "./release";

export interface PortalDeployment {
  context: string;
  siteId?: string;
  deployPrimeUrl?: string;
  deployUrl?: string;
  siteUrl?: string;
  ephemeral?: boolean;
  testUrl?: string;
}
const productionOrigin = "https://portal.d-a-j.com";
const stagingSiteId = "d83ff6cb-f57b-4741-8c3c-3eaae7adab19";
const stagingOrigin = "https://coachd-staging.netlify.app";
const productionHosts = [
  "portal.d-a-j.com",
  "portal.daj.com",
  "studio-portal.netlify.app",
];

/** Only trusted deployment metadata is accepted. Never read a request Origin/header. */
export function resolvePortalOrigin(deployment: PortalDeployment): string {
  if (deployment.context === "production") {
    // Both sites publish in production context. The staging exception requires
    // Netlify's read-only site ID and its exact canonical URL together.
    const site = deployment.siteUrl ? new URL(deployment.siteUrl) : undefined;
    const staging = deployment.siteId === stagingSiteId;
    if (
      !site ||
      site.protocol !== "https:" ||
      site.username ||
      site.password ||
      site.port ||
      !(staging
        ? site.href === `${stagingOrigin}/`
        : productionHosts.includes(site.hostname))
    )
      throw new Error(
        "PROVIDER_UNAVAILABLE: Production context requires a trusted production site URL.",
      );
    return staging ? stagingOrigin : productionOrigin;
  }
  const configured = deployment.ephemeral
    ? deployment.testUrl
    : deployment.deployUrl || deployment.deployPrimeUrl || deployment.siteUrl;
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
    productionHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  )
    throw new Error(
      "PROVIDER_UNAVAILABLE: A non-production deployment must use its own portal URL.",
    );
  return url.origin;
}

export function portalOrigin() {
  return resolvePortalOrigin({
    context: releaseMetadata().context,
    siteId: Netlify.env.get("SITE_ID"),
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
