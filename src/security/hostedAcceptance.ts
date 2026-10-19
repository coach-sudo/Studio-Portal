/** The approved immutable, read-only Wave 1 acceptance target. */
export const hostedAcceptance = {
  origin: "https://6ad23d4f8b10c10447224155--coachd-staging.netlify.app",
  project: "lrxrivfqjpkvygozphoz",
  commit: "0b18a5a2238daa49bec1290f5884d5792f4aefc9",
  studio: "4ceff683-e72f-4b2e-96ce-85db2dca4eb2",
  student: "be0657a3-0f36-477a-949a-491afb24809c",
} as const;

const readRpcs = new Set([
  "studio_route_snapshot",
  "student_workspace_summary",
  "student_workspace_resource",
  "student_financial_overview",
  "student_credit_coverage",
  "student_credit_history",
  "search_material_resources",
  "search_material_options",
  "get_material_resource",
  "get_material_assignment",
  "search_material_collections",
  "get_material_collection",
]);

export function assertHostedAcceptanceTarget(value: string) {
  if (value !== hostedAcceptance.origin)
    throw Error("Wrong immutable acceptance target");
}

/** Auth sessions are authorized; business writes and unreviewed RPCs are not. */
export function allowedHostedRequest(
  method: string,
  value: string,
  target: { origin: string; project: string } = hostedAcceptance,
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    return false;
  if (url.pathname.includes("%")) return false;
  const read = ["GET", "HEAD", "OPTIONS"].includes(method);
  if (url.origin === target.origin) {
    if (url.pathname.startsWith("/.netlify/functions/")) return false;
    if (url.pathname.startsWith("/api/")) {
      return (
        (read &&
          [
            "/api/healthz",
            "/api/invoices",
            "/api/v2/public/booking/services",
          ].includes(url.pathname)) ||
        (method === "POST" && url.pathname === "/api/v2/auth/login")
      );
    }
    return read;
  }
  if (url.origin === `https://${target.project}.supabase.co`) {
    if (url.pathname.startsWith("/auth/v1/")) {
      return (
        (read &&
          ["/auth/v1/user", "/auth/v1/settings"].includes(url.pathname)) ||
        (method === "POST" &&
          (url.pathname === "/auth/v1/logout" ||
            (url.pathname === "/auth/v1/token" &&
              ["password", "refresh_token"].includes(
                url.searchParams.get("grant_type") || "",
              ))))
      );
    }
    if (url.pathname.startsWith("/rest/v1/rpc/"))
      return (
        ["POST", "GET"].includes(method) &&
        readRpcs.has(url.pathname.slice("/rest/v1/rpc/".length))
      );
    return read && url.pathname.startsWith("/rest/v1/");
  }
  return (
    read && ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)
  );
}

/** Existing fixture infrastructure has separate explicit mutation authority. */
export function assertFixtureMutationTarget(value: string) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw Error(
      "Hosted fixture mutations are not authorized by this acceptance lane",
    );
}
