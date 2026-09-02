import type { Config } from "@netlify/functions";
import { dispatchOutbox } from "./_shared/outbox-dispatch";
export default async()=>Response.json({ok:true,...await dispatchOutbox({batchSize:50})});
export const config:Config={schedule:"*/5 * * * *"};
