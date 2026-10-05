import { useState } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Dialog, Section, Status } from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import type { OutboxMessage, StudioSnapshot } from "../../domain/model";
import { formatStudioDateTime } from "../../domain/presentation";
import { supabase } from "../../lib/supabase";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";
import "./operational-intelligence.css";

export function StudentCommunication({
  data,
  studentId,
  isDemo,
}: {
  data: StudioSnapshot;
  studentId: string;
  isDemo: boolean;
}) {
  const client = useQueryClient(),
    store = useStudioStore();
  const [page, setPage] = useState(1),
    [tab, setTab] = useState<"upcoming" | "recent">("upcoming"),
    [selected, setSelected] = useState<OutboxMessage>(),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const statuses =
    tab === "upcoming"
      ? ["queued", "draft", "approved"]
      : ["sent", "failed", "cancelled", "sending"];
  const query = useQuery({
    queryKey: [
      "studio-page",
      "messaging",
      "student-communication",
      data.studioId,
      studentId,
      tab,
      page,
    ],
    enabled: !isDemo && Boolean(supabase),
    placeholderData: keepPreviousData,
    staleTime: 30000,
    queryFn: async ({ signal }) => {
      const result = await supabase!
        .from("outbox_messages")
        .select("*", { count: "exact" })
        .eq("studio_id", data.studioId)
        .eq("student_id", studentId)
        .in("status", statuses as OutboxMessage["status"][])
        .order("send_at", { ascending: tab === "upcoming", nullsFirst: false })
        .order("id")
        .range((page - 1) * 25, page * 25 - 1)
        .abortSignal(signal);
      if (result.error) throw result.error;
      return {
        total: result.count ?? 0,
        items: result.data.map((row) => ({
          id: row.id,
          studentId: row.student_id ?? undefined,
          lessonId: row.lesson_id ?? undefined,
          bookingId: row.booking_id ?? undefined,
          channel: "email" as const,
          recipient: row.recipient,
          subject: row.subject,
          body: row.body,
          status: row.status,
          attempts: row.attempts,
          lastError: row.last_error ?? undefined,
          sendAt: row.send_at ?? undefined,
          eventKey: row.event_key ?? undefined,
          suppressionReason: row.suppression_reason ?? undefined,
          version: row.version,
          updatedAt: row.updated_at,
        })),
      };
    },
  });
  const attempts = useQuery({
    queryKey: ["studio-page", "messaging", "delivery-attempts", selected?.id],
    enabled: !isDemo && Boolean(supabase && selected),
    queryFn: async ({ signal }) => {
      const result = await supabase!
        .from("delivery_attempts")
        .select("id,created_at,succeeded,error")
        .eq("outbox_message_id", selected!.id)
        .order("created_at", { ascending: false })
        .limit(20)
        .abortSignal(signal);
      if (result.error) throw result.error;
      return result.data;
    },
  });
  const demo = data.outbox
    .filter(
      (item) => item.studentId === studentId && statuses.includes(item.status),
    )
    .sort(
      (a, b) =>
        (a.sendAt ?? a.updatedAt).localeCompare(b.sendAt ?? b.updatedAt) *
        (tab === "upcoming" ? 1 : -1),
    );
  const result = isDemo
    ? { total: demo.length, items: demo.slice((page - 1) * 25, page * 25) }
    : query.data;
  async function act(
    message: OutboxMessage,
    command: "cancel_message" | "send_now" | "retry_message",
  ) {
    setBusy(true);
    setNotice("");
    try {
      if (isDemo) {
        if (command !== "cancel_message")
          throw new Error(
            "Delivery controls require the isolated/live coach API. Demo never sends email.",
          );
        store.transact((draft) => {
          const item = draft.outbox.find((row) => row.id === message.id);
          if (item) {
            item.status = "cancelled";
            item.suppressionReason = "coach_cancelled";
          }
        });
      } else
        await studioCommand("automations", {
          command,
          entityId: message.id,
          expectedVersion: message.version,
          reason: "Coach communication timeline action",
        });
      setNotice(
        command === "cancel_message"
          ? "Message cancelled. History retained."
          : "Message queued for delivery after current-state checks.",
      );
      await invalidateStudioDomains(client, ["messaging"]);
      setSelected(undefined);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "The message could not be changed.",
      );
      await invalidateStudioDomains(client, ["messaging"]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title="Communication timeline" marked>
      <p>Coach-only email history. Human conversations remain in Inbox.</p>
      <div className="action-row">
        <button
          type="button"
          aria-pressed={tab === "upcoming"}
          onClick={() => {
            setTab("upcoming");
            setPage(1);
          }}
        >
          Upcoming
        </button>
        <button
          type="button"
          aria-pressed={tab === "recent"}
          onClick={() => {
            setTab("recent");
            setPage(1);
          }}
        >
          Recent & suppressed
        </button>
      </div>
      <p role="status">{notice}</p>
      {query.isError && (
        <p role="alert">
          Email history could not be loaded.{" "}
          <button type="button" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      )}
      {!isDemo && query.isPending ? (
        <p role="status">Loading communication…</p>
      ) : !result?.items.length ? (
        <p>
          No {tab === "upcoming" ? "scheduled messages" : "recent messages"}.
        </p>
      ) : (
        result.items.map((message) => (
          <article className="communication-card" key={message.id}>
            <div className="action-row">
              <strong>{message.subject}</strong>
              <Status>{message.status}</Status>
            </div>
            <p>
              {message.recipient} · {message.eventKey || "Email"}
            </p>
            <p>
              {formatStudioDateTime(
                message.sendAt ?? message.updatedAt,
                data.settings.timezone,
              )}
              {message.lessonId && (
                <>
                  {" "}
                  ·{" "}
                  <Link
                    to={`/coach/students/${studentId}/lessons/${message.lessonId}`}
                  >
                    Related lesson
                  </Link>
                </>
              )}
            </p>
            {message.suppressionReason && (
              <p>
                Suppressed: {message.suppressionReason.replaceAll("_", " ")}
              </p>
            )}
            <button type="button" onClick={() => setSelected(message)}>
              Preview & history
            </button>
          </article>
        ))
      )}
      {result && result.total > 25 && (
        <nav className="action-row" aria-label="Communication pages">
          <button
            type="button"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </button>
          <span>
            Page {page} of {Math.ceil(result.total / 25)}
          </span>
          <button
            type="button"
            disabled={page * 25 >= result.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </nav>
      )}
      {selected && (
        <Dialog
          title="Email preview"
          description={selected.subject}
          onClose={() => setSelected(undefined)}
        >
          <p>To: {selected.recipient}</p>
          <pre className="communication-preview">{selected.body}</pre>
          <p>
            Status: {selected.status} · {selected.attempts} attempt(s)
          </p>
          {attempts.isError && (
            <p role="alert">Delivery history could not be loaded.</p>
          )}
          {attempts.data?.map((attempt) => (
            <p key={attempt.id}>
              {formatStudioDateTime(attempt.created_at, data.settings.timezone)}{" "}
              · {attempt.succeeded ? "Delivered" : "Failed"}
              {attempt.error ? ` · ${attempt.error}` : ""}
            </p>
          ))}
          {["draft", "approved", "queued", "failed"].includes(
            selected.status,
          ) && (
            <div className="action-row">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void act(
                    selected,
                    selected.status === "failed" ? "retry_message" : "send_now",
                  )
                }
              >
                {selected.status === "failed"
                  ? "Retry with checks"
                  : "Send now with checks"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(selected, "cancel_message")}
              >
                Cancel message
              </button>
            </div>
          )}
          <p>
            Send-time checks still enforce current payment, scheduling and
            recipient permissions.
          </p>
        </Dialog>
      )}
    </Section>
  );
}
