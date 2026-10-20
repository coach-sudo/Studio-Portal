import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, Section, Status } from "../../components/Primitives";
import { WritingArea } from "../../components/WritingArea";
import {
  loadCampaignOverview,
  campaignDraftCommand,
  type CampaignDraftRecord,
  type CampaignDraftValue,
} from "../../data/campaigns";
import {
  campaignStartingTemplate,
  campaignContentSchema,
  renderCampaignContent,
  type CampaignBlock,
} from "../../domain/campaignBlocks";
import {
  renderCampaignTemplate,
  type CampaignValues,
} from "../../domain/campaignTemplates";
import { useStudioRoute } from "../../hooks/useStudio";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";
import { useUnsavedWorkspaceChanges } from "../../hooks/useWorkspaceLocation";
import { studioCommand } from "../../data/bookingCommands";
import { useStudioStore } from "../../state/StudioStore";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { campaignTokens } from "../../domain/campaignTemplates";
import "./Campaigns.css";
const steps = ["Compose", "Audience", "Preview", "Review", "Send / Schedule"];
const empty = (): CampaignDraftValue => ({
  name: "",
  subject: "",
  content: campaignStartingTemplate("announcement"),
  recipientEmails: [],
  sendAt: null,
});
export function Campaigns() {
  const { data, isDemo } = useStudioRoute("coach", undefined, ["identity"]),
    identity = usePrivateIdentity(),
    client = useQueryClient();
  const store = useStudioStore();
  const [record, setRecord] = useState<CampaignDraftRecord>(() => ({
      id: crypto.randomUUID(),
      version: 0,
      value: empty(),
    })),
    [dirty, setDirty] = useState(false),
    [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [historyPage, setHistoryPage] = useState(1),
    [search, setSearch] = useState(""),
    [historySearch, setHistorySearch] = useState(""),
    [recipientSearch, setRecipientSearch] = useState(""),
    [recipientPage, setRecipientPage] = useState(1),
    [selection, setSelection] = useState(false);
  const query = useQuery({
    queryKey: ["campaign-overview", identity, historyPage, historySearch],
    queryFn: () => loadCampaignOverview(historyPage, historySearch),
    enabled: !isDemo && !!identity,
  });
  const discard = useUnsavedWorkspaceChanges(dirty),
    value = record.value;
  const edit = (patch: Partial<CampaignDraftValue>) => {
    setRecord((r) => ({ ...r, value: { ...r.value, ...patch }, review: null }));
    setDirty(true);
    setConfirmed(false);
    setNotice("");
  };
  const setBlocks = (blocks: CampaignBlock[]) =>
    edit({ content: { version: 1, blocks } });
  const block = (id: string, patch: Record<string, unknown>) =>
    setBlocks(
      value.content.blocks.map((b) =>
        b.id === id ? ({ ...b, ...patch } as CampaignBlock) : b,
      ),
    );
  const move = (index: number, offset: number) => {
    const blocks = [...value.content.blocks],
      target = index + offset;
    if (target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    setBlocks(blocks);
  };
  const eligible = query.data?.contacts.filter((c) => c.subscribed) || [],
    audience = selection
      ? eligible.filter((c) => value.recipientEmails.includes(c.email))
      : eligible;
  const sample = audience[0],
    values: CampaignValues = {
      firstName: sample?.name.split(" ")[0] || "Taylor",
      fullName: sample?.name || "Taylor Example",
      email: sample?.email || "example@example.test",
      studioName: data?.settings.studioName || "Studio",
      portalUrl: window.location.origin + "/portal",
      unsubscribeUrl: window.location.origin + "/unsubscribe/preview",
    };
  let preview: { html: string; text: string } | undefined;
  try {
    preview = renderCampaignContent(value.content, values);
  } catch {
    /* Invalid edits are shown before review; never queued. */
  }
  const save = async () => {
    const next = await campaignDraftCommand(
      "save",
      record.id,
      record.version,
      value as unknown as Record<string, unknown>,
    );
    setRecord(next);
    setDirty(false);
    await client.invalidateQueries({ queryKey: ["campaign-overview"] });
    return next;
  };
  const saveTemplate = async () => {
    if (busy || !data) return;
    setBusy(true);
    setNotice("");
    try {
      const content = campaignContentSchema.parse(value.content),
        tokens = Object.fromEntries(
          campaignTokens.map((k) => [k, `{{${k}}}`]),
        ) as CampaignValues;
      const template = {
        id: crypto.randomUUID(),
        name: value.name,
        subject: value.subject,
        body: renderCampaignContent(content, tokens).text,
        content,
      };
      if (template.name.trim().length < 2 || template.subject.trim().length < 2)
        throw new Error("Add a template name and subject first.");
      const templates = [...data.settings.campaignTemplates, template];
      if (isDemo)
        store.transact((draft) => {
          draft.settings.campaignTemplates = templates;
        });
      else {
        await studioCommand("settings", {
          command: "update",
          expectedVersion: 1,
          payload: {
            settings: { campaignTemplates: templates },
            baseSettings: data.settings,
          },
          reason: "Coach saved reusable campaign template",
        });
        await invalidateStudioDomains(client, ["identity"]);
      }
      setNotice("Template saved. No messages queued.");
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Template could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const perform = async (kind: "save" | "review" | "queue") => {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (isDemo)
        throw new Error(
          "Connect a studio to save or queue campaigns. Preview is available here.",
        );
      if (selection && !value.recipientEmails.length)
        throw new Error("Select at least one recipient.");
      if (kind === "save") {
        await save();
        setNotice("Draft saved. No messages queued.");
      } else if (kind === "review") {
        const next = dirty || !record.version ? await save() : record;
        setRecord(await campaignDraftCommand("review", next.id, next.version));
        setConfirmed(false);
        setStep(3);
        setRecipientPage(1);
      } else {
        if (!record.review || dirty || !confirmed)
          throw new Error("Prepare and approve the current review first.");
        const result = await campaignDraftCommand(
          "queue",
          record.id,
          record.version,
          { reviewId: record.review.id },
        );
        setRecord((r) => ({
          ...r,
          result: {
            id: result.id,
            recipientCount: result.recipientCount!,
            sendAt: result.sendAt!,
          },
        }));
        setNotice(
          `${result.recipientCount} messages queued${value.sendAt ? " for the reviewed schedule" : ""}. Delivery remains separately observable.`,
        );
        await client.invalidateQueries({ queryKey: ["campaign-overview"] });
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Campaign action failed.");
    } finally {
      setBusy(false);
    }
  };
  const open = (next?: CampaignDraftRecord) => {
    if (!discard()) return;
    setRecord(next || { id: crypto.randomUUID(), version: 0, value: empty() });
    setDirty(false);
    setConfirmed(false);
    setSelection(!!next?.value.recipientEmails.length);
    setStep(0);
    setNotice("");
  };
  if (!data) return <p role="status">Opening campaigns…</p>;
  const filtered = eligible.filter((c) =>
    (c.name + " " + c.email)
      .toLowerCase()
      .includes(recipientSearch.toLowerCase()),
  );
  return (
    <div className="campaigns-page">
      <PageHeader
        title="Campaigns"
        action={<button onClick={() => open()}>New campaign</button>}
      >
        Draft, review and schedule studio updates.
      </PageHeader>
      {notice && (
        <p role="status" className="portal-notice">
          {notice}
        </p>
      )}
      <div className="campaigns-grid">
        <Section
          title={record.result ? "Queued campaign" : "Campaign builder"}
          marked
        >
          <nav className="campaign-steps" aria-label="Campaign steps">
            {steps.map((s, i) => (
              <button
                key={s}
                aria-current={step === i ? "step" : undefined}
                onClick={() => setStep(i)}
              >
                {i + 1}. {s}
              </button>
            ))}
          </nav>
          {record.result ? (
            <div>
              <Status tone="good">Queued</Status>
              <p>
                {record.result.recipientCount} recipients ·{" "}
                {new Date(record.result.sendAt).toLocaleString()}
              </p>
              <p>
                Start a new draft for another campaign. This receipt will not
                send twice.
              </p>
            </div>
          ) : (
            <>
              {step === 0 && (
                <div className="workflow-form">
                  <label>
                    Name
                    <input
                      value={value.name}
                      maxLength={120}
                      onChange={(e) => edit({ name: e.target.value })}
                    />
                  </label>
                  <label>
                    Subject
                    <input
                      value={value.subject}
                      maxLength={200}
                      onChange={(e) => edit({ subject: e.target.value })}
                    />
                  </label>
                  <label className="full">
                    Starting template
                    <select
                      value=""
                      onChange={(e) => {
                        const key = e.target.value;
                        if (!key) return;
                        if (
                          [
                            "announcement",
                            "lesson-update",
                            "studio-news",
                          ].includes(key)
                        )
                          edit({
                            content: campaignStartingTemplate(
                              key as
                                | "announcement"
                                | "lesson-update"
                                | "studio-news",
                            ),
                          });
                        else {
                          const t = data.settings.campaignTemplates.find(
                            (t) => t.id === key,
                          );
                          if (t)
                            edit({
                              name: t.name,
                              subject: t.subject,
                              content: {
                                version: 1,
                                blocks: t.content?.blocks || [
                                  {
                                    id: crypto.randomUUID(),
                                    type: "text",
                                    text: t.body,
                                  },
                                ],
                              },
                            });
                        }
                      }}
                    >
                      <option value="">Choose a reusable starting point</option>
                      <option value="announcement">Announcement</option>
                      <option value="lesson-update">Lesson update</option>
                      <option value="studio-news">Studio news</option>
                      {data.settings.campaignTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          Saved text: {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="full campaign-block-list">
                    {value.content.blocks.map((b, i) => (
                      <fieldset key={b.id}>
                        <legend>
                          {i + 1}. {b.type}
                        </legend>
                        <div className="form-actions">
                          <button
                            disabled={i === 0}
                            onClick={() => move(i, -1)}
                            aria-label={`Move block ${i + 1} up`}
                          >
                            Up
                          </button>
                          <button
                            disabled={i === value.content.blocks.length - 1}
                            onClick={() => move(i, 1)}
                            aria-label={`Move block ${i + 1} down`}
                          >
                            Down
                          </button>
                          <button
                            onClick={() =>
                              setBlocks(
                                value.content.blocks.filter(
                                  (x) => x.id !== b.id,
                                ),
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                        {(b.type === "heading" || b.type === "text") && (
                          <label>
                            Text
                            <WritingArea
                              value={b.text}
                              onChange={(e) =>
                                block(b.id, { text: e.target.value })
                              }
                            />
                          </label>
                        )}
                        {b.type === "image" && (
                          <>
                            <label>
                              Image HTTPS URL
                              <input
                                type="url"
                                value={b.url}
                                onChange={(e) =>
                                  block(b.id, { url: e.target.value })
                                }
                              />
                            </label>
                            <label>
                              Image description
                              <input
                                value={b.alt}
                                onChange={(e) =>
                                  block(b.id, { alt: e.target.value })
                                }
                              />
                            </label>
                          </>
                        )}
                        {b.type === "button" && (
                          <>
                            <label>
                              Button label
                              <input
                                value={b.label}
                                onChange={(e) =>
                                  block(b.id, { label: e.target.value })
                                }
                              />
                            </label>
                            <label>
                              Link
                              <input
                                value={b.url}
                                onChange={(e) =>
                                  block(b.id, { url: e.target.value })
                                }
                              />
                            </label>
                          </>
                        )}
                        {b.type === "columns" && (
                          <>
                            <label>
                              Left column
                              <WritingArea
                                value={b.left}
                                onChange={(e) =>
                                  block(b.id, { left: e.target.value })
                                }
                              />
                            </label>
                            <label>
                              Right column
                              <WritingArea
                                value={b.right}
                                onChange={(e) =>
                                  block(b.id, { right: e.target.value })
                                }
                              />
                            </label>
                          </>
                        )}
                      </fieldset>
                    ))}
                  </div>
                  <details className="full">
                    <summary>Personalization fields</summary>
                    <p>{campaignTokens.map((t) => `{{${t}}}`).join(", ")}</p>
                  </details>
                  <label className="full">
                    Add block
                    <select
                      value=""
                      disabled={value.content.blocks.length >= 60}
                      onChange={(e) => {
                        const type = e.target.value as CampaignBlock["type"];
                        if (!type) return;
                        const id = crypto.randomUUID();
                        const next: CampaignBlock =
                          type === "image"
                            ? { id, type, url: "", alt: "" }
                            : type === "button"
                              ? {
                                  id,
                                  type,
                                  url: "{{portalUrl}}",
                                  label: "Open portal",
                                }
                              : type === "columns"
                                ? { id, type, left: "", right: "" }
                                : type === "divider"
                                  ? { id, type }
                                  : { id, type, text: "" };
                        setBlocks([...value.content.blocks, next]);
                      }}
                    >
                      <option value="">Choose a block</option>
                      {[
                        "heading",
                        "text",
                        "image",
                        "button",
                        "divider",
                        "columns",
                      ].map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              {step === 1 && (
                <>
                  <h3>Audience</h3>
                  <p>
                    {audience.length} subscribed recipients. Current consent is
                    checked again before queueing and delivery.
                  </p>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={!selection}
                      onChange={(e) => {
                        setSelection(!e.target.checked);
                        edit({ recipientEmails: [] });
                      }}
                    />
                    All eligible studio contacts
                  </label>
                  {selection && (
                    <>
                      <label>
                        Find recipients
                        <input
                          type="search"
                          value={recipientSearch}
                          onChange={(e) => {
                            setRecipientSearch(e.target.value);
                            setRecipientPage(1);
                          }}
                        />
                      </label>
                      {filtered
                        .slice((recipientPage - 1) * 25, recipientPage * 25)
                        .map((c) => (
                          <label key={c.email} className="check-row">
                            <input
                              type="checkbox"
                              checked={value.recipientEmails.includes(c.email)}
                              onChange={(e) =>
                                edit({
                                  recipientEmails: e.target.checked
                                    ? [...value.recipientEmails, c.email]
                                    : value.recipientEmails.filter(
                                        (x) => x !== c.email,
                                      ),
                                })
                              }
                            />
                            {c.name} · {c.email}
                          </label>
                        ))}
                      <div className="form-actions">
                        <button
                          disabled={recipientPage === 1}
                          onClick={() => setRecipientPage(recipientPage - 1)}
                        >
                          Previous
                        </button>
                        <span>Page {recipientPage}</span>
                        <button
                          disabled={recipientPage * 25 >= filtered.length}
                          onClick={() => setRecipientPage(recipientPage + 1)}
                        >
                          Next
                        </button>
                      </div>
                    </>
                  )}
                  <label>
                    Send time
                    <select
                      value={value.sendAt ? "schedule" : "now"}
                      onChange={(e) =>
                        edit({
                          sendAt:
                            e.target.value === "now"
                              ? null
                              : new Date(Date.now() + 3600000).toISOString(),
                        })
                      }
                    >
                      <option value="now">After final confirmation</option>
                      <option value="schedule">Schedule</option>
                    </select>
                  </label>
                  {value.sendAt && (
                    <label>
                      Scheduled time (your device timezone)
                      <input
                        type="datetime-local"
                        value={new Date(
                          Date.parse(value.sendAt) -
                            new Date(value.sendAt).getTimezoneOffset() * 60000,
                        )
                          .toISOString()
                          .slice(0, 16)}
                        onChange={(e) => {
                          if (e.target.value)
                            edit({
                              sendAt: new Date(e.target.value).toISOString(),
                            });
                        }}
                      />
                    </label>
                  )}
                </>
              )}
              {step === 2 && (
                <>
                  <h3>
                    {renderCampaignTemplate(value.subject, values) ||
                      "Subject preview"}
                  </h3>
                  {preview ? (
                    <>
                      <iframe
                        className="campaign-html-preview"
                        title="Campaign email preview"
                        sandbox=""
                        srcDoc={preview.html}
                      />
                      <details>
                        <summary>Plain text version</summary>
                        <pre className="campaign-text-preview">
                          {preview.text}
                        </pre>
                      </details>
                    </>
                  ) : (
                    <p role="alert">
                      Complete valid blocks and HTTPS links before previewing.
                    </p>
                  )}
                </>
              )}
              {step >= 3 && (
                <>
                  <h3>Final review</h3>
                  <p>
                    {value.name} · {value.subject}
                  </p>
                  <p>
                    {value.sendAt
                      ? `Scheduled ${new Date(value.sendAt).toLocaleString()}`
                      : "Queues after your explicit confirmation"}
                  </p>
                  <p>
                    {record.review?.audience.length ?? audience.length}{" "}
                    recipients · {value.content.blocks.length} content blocks
                  </p>
                  <button
                    disabled={
                      busy ||
                      !campaignContentSchema.safeParse(value.content).success
                    }
                    onClick={() => void perform("review")}
                  >
                    {record.review && !dirty
                      ? "Refresh review"
                      : "Prepare authoritative review"}
                  </button>
                  {record.review && !dirty && (
                    <>
                      <p>
                        Review expires{" "}
                        {new Date(record.review.expiresAt).toLocaleTimeString()}
                        . Changes to content, audience or schedule require
                        another review.
                      </p>
                      <details>
                        <summary>Reviewed audience</summary>
                        {record.review.audience
                          .slice((recipientPage - 1) * 25, recipientPage * 25)
                          .map((c) => (
                            <p key={c.email}>
                              {c.name} · {c.email}
                            </p>
                          ))}
                        <div className="form-actions">
                          <button
                            disabled={recipientPage === 1}
                            onClick={() => setRecipientPage(recipientPage - 1)}
                          >
                            Previous recipients
                          </button>
                          <span>Page {recipientPage}</span>
                          <button
                            disabled={
                              recipientPage * 25 >=
                              record.review.audience.length
                            }
                            onClick={() => setRecipientPage(recipientPage + 1)}
                          >
                            Next recipients
                          </button>
                        </div>
                      </details>
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(e) => setConfirmed(e.target.checked)}
                        />
                        I reviewed the Preview, recipient audience and send
                        time.
                      </label>
                      <button
                        className="primary"
                        disabled={busy || !confirmed}
                        onClick={() => void perform("queue")}
                      >
                        {busy
                          ? "Queueing…"
                          : value.sendAt
                            ? "Confirm schedule"
                            : "Confirm send"}
                      </button>
                    </>
                  )}
                </>
              )}
              <footer className="form-actions">
                <button disabled={busy} onClick={() => void perform("save")}>
                  Save draft
                </button>
                <button disabled={busy} onClick={() => void saveTemplate()}>
                  Save as template
                </button>
                {step > 0 && (
                  <button onClick={() => setStep(step - 1)}>Back</button>
                )}
                {step < 4 && (
                  <button onClick={() => setStep(step + 1)}>
                    Continue to {steps[step + 1]}
                  </button>
                )}
              </footer>
            </>
          )}
        </Section>
        <aside className="campaigns-side">
          <Section title="Saved drafts">
            <p>Saving and previewing never queue messages.</p>
            {query.isError && (
              <p role="alert">
                Drafts unavailable.{" "}
                <button onClick={() => void query.refetch()}>Retry</button>
              </p>
            )}
            {query.data?.drafts?.map((d) => (
              <button
                className="campaign-draft-choice"
                key={d.id}
                onClick={() => open(d)}
              >
                <strong>{d.value.name}</strong>
                <small>
                  {d.result
                    ? "Queued receipt"
                    : d.review
                      ? "Reviewed draft"
                      : "Draft"}
                </small>
              </button>
            ))}
          </Section>
        </aside>
      </div>
      <Section title="Campaign history">
        <div className="form-actions">
          <input
            aria-label="Search campaign history"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            onClick={() => {
              setHistorySearch(search);
              setHistoryPage(1);
            }}
          >
            Search
          </button>
        </div>
        <div className="table-list">
          {query.data?.campaigns.map((c) => (
            <article key={c.id}>
              <div>
                <strong>{c.name}</strong>
                <small>
                  {c.subject_template} ·{" "}
                  {new Date(c.created_at).toLocaleDateString()}
                </small>
              </div>
              <span>
                {c.recipient_count} recipients · {c.sent_count} sent ·{" "}
                {c.queued_count} queued · {c.failed_count} failed ·{" "}
                {c.cancelled_count} stopped
              </span>
            </article>
          ))}
        </div>
        <div className="form-actions">
          <button
            disabled={historyPage === 1}
            onClick={() => setHistoryPage(historyPage - 1)}
          >
            Previous
          </button>
          <span>Page {historyPage}</span>
          <button
            disabled={historyPage * 20 >= (query.data?.historyCount || 0)}
            onClick={() => setHistoryPage(historyPage + 1)}
          >
            Next
          </button>
        </div>
      </Section>
    </div>
  );
}
