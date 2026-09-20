import type { Config } from "@netlify/functions";
import { releaseMetadata } from "./_shared/release";

export default async () =>
  Response.json(
    {
      status: "ok",
      release: releaseMetadata(),
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );

export const config: Config = { path: "/api/healthz" };
