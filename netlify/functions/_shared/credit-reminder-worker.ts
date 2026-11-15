import { z } from "zod";
import { googleAccessToken, sendGmail } from "./google";
import { portalOrigin } from "./portal-url";
import { serviceClient } from "./supabase";
import { creditRemindersEnabled } from "./worker-controls";

const claimSchema = z.array(z.object({ id: z.string(), token: z.string() }));
const messageSchema = z.object({
  recipient: z.string(),
  subject: z.string(),
  body: z.string(),
  actionPath: z.string().startsWith("/portal/credits?"),
});

export async function runCreditReminderBatch(
  db: ReturnType<typeof serviceClient>,
  deadline: number,
  transport = {
    authorize: googleAccessToken,
    send: sendGmail,
    origin: portalOrigin,
  },
) {
  if (!creditRemindersEnabled() || Date.now() >= deadline) return;
  const scan = await db.rpc("scan_credit_reminders", { p_limit: 8 });
  if (scan.error) throw scan.error;
  // Disposable fixtures exercise email with an injected transport in tests.
  if (globalThis.Netlify?.env.get("E2E_EPHEMERAL") === "true") return;
  if (!creditRemindersEnabled() || Date.now() >= deadline) return;
  const claims = await db.rpc("claim_credit_reminder_email", { p_limit: 4 });
  if (claims.error) throw claims.error;
  let accessToken: string | undefined;
  let origin: string | undefined;
  for (const claim of claimSchema.parse(claims.data)) {
    if (!creditRemindersEnabled() || Date.now() >= deadline) return;
    const key = { p_delivery: claim.id, p_token: claim.token };
    const settle = async (
      outcome:
        "sent" | "uncertain" | "retry_before_send" | "cancel_before_send",
      reference?: string,
    ) => {
      const result = await db.rpc("finish_credit_reminder_email", {
        ...key,
        p_outcome: outcome,
        ...(reference ? { p_reference: reference } : {}),
      });
      if (result.error) throw result.error;
    };
    try {
      origin ??= transport.origin();
      accessToken ??= await transport.authorize();
    } catch {
      await settle("retry_before_send");
      continue;
    }
    if (!creditRemindersEnabled()) return;
    const start = await db.rpc("begin_credit_reminder_email", key);
    if (start.error) throw start.error;
    if (!start.data) continue;
    const parsed = messageSchema.safeParse(start.data);
    if (
      !parsed.success ||
      !creditRemindersEnabled() ||
      Date.now() >= deadline
    ) {
      await settle("cancel_before_send");
      continue;
    }
    const message = parsed.data;
    const url = new URL(message.actionPath, origin).href;
    let reference: string | undefined;
    try {
      reference = (
        await transport.send(accessToken, {
          recipient: message.recipient,
          subject: message.subject,
          body: message.body.includes(message.actionPath)
            ? message.body.replaceAll(message.actionPath, url)
            : message.body + "\n\n" + url,
        })
      ).id;
    } catch {
      // The provider may have accepted a request before the connection failed.
      await settle("uncertain");
      continue;
    }
    await settle(reference ? "sent" : "uncertain", reference);
  }
}
