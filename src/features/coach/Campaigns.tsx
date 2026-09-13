import { useQueryClient } from "@tanstack/react-query";
import { Mail, Plus, RefreshCw, Send, Trash2, Users } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { PageHeader, Section, Status } from "../../components/Primitives";
import {
  loadCampaignOverview,
  queueCampaign,
  type CampaignOverview,
} from "../../data/campaigns";
import { studioCommand } from "../../data/bookingCommands";
import {
  renderCampaignTemplate,
  unknownCampaignTokens,
} from "../../domain/campaignTemplates";
import type { StudioSettings, StudioSnapshot } from "../../domain/model";
import { useStudio } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";
import "./Campaigns.css";

type Template = StudioSettings["campaignTemplates"][number];
type Draft = Pick<Template, "name" | "subject" | "body">;
const emptyDraft: Draft = { name: "", subject: "", body: "" };

function demoOverview(data: StudioSnapshot): CampaignOverview {
  const contacts = new Map<
    string,
    { email: string; name: string; subscribed: boolean }
  >();
  const add = (address: string | undefined, name: string) => {
    const email = address?.trim().toLowerCase();
    if (email?.includes("@") && !contacts.has(email))
      contacts.set(email, { email, name, subscribed: true });
  };
  const activeStudentIds = new Set(
    data.students
      .filter((student) => !student.deletedAt)
      .map((student) => student.id),
  );
  for (const contact of data.linkedContacts)
    if (activeStudentIds.has(contact.studentId))
      add(contact.email, contact.fullName);
  for (const student of data.students) {
    if (student.deletedAt) continue;
    add(student.guardianEmail, student.guardianName || "Guardian");
    add(student.email, student.fullName);
  }
  return { contacts: [...contacts.values()], campaigns: [] };
}

export function Campaigns() {
  const { data, isDemo } = useStudio();
  const store = useStudioStore();
  const queryClient = useQueryClient();
  const [overview, setOverview] = useState<CampaignOverview>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [reviewing, setReviewing] = useState(false);
  const [sendKey, setSendKey] = useState(() => crypto.randomUUID());
  const studioId = data?.studioId;

  useEffect(() => {
    if (!studioId || !data) return;
    if (isDemo) {
      setOverview(demoOverview(data));
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void loadCampaignOverview()
      .then((value) => {
        if (active) setOverview(value);
      })
      .catch((error) => {
        if (active)
          setNotice(
            error instanceof Error
              ? error.message
              : "Mailing list could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [studioId, isDemo]);

  const templates = data?.settings.campaignTemplates || [];
  const recipients =
    overview?.contacts.filter((contact) => contact.subscribed) || [];
  const optedOut = (overview?.contacts.length || 0) - recipients.length;
  const unknown = unknownCampaignTokens(`${draft.subject}\n${draft.body}`);
  const sample = recipients[0];
  const previewValues = useMemo(
    () => ({
      firstName: sample?.name.split(" ")[0] || "Taylor",
      fullName: sample?.name || "Taylor Example",
      email: sample?.email || "taylor@example.com",
      studioName: data?.settings.studioName || "Your studio",
      portalUrl: `${window.location.origin}/portal`,
      unsubscribeUrl: `${window.location.origin}/unsubscribe/example-link`,
    }),
    [sample?.email, sample?.name, data?.settings.studioName],
  );

  const editDraft = (updates: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...updates }));
    setReviewing(false);
    setSendKey(crypto.randomUUID());
  };
  const selectTemplate = (id: string) => {
    const selected = templates.find((item) => item.id === id);
    setSelectedId(id);
    setDraft(selected || emptyDraft);
    setReviewing(false);
    setSendKey(crypto.randomUUID());
  };
  const saveTemplates = async (next: Template[]) => {
    if (!data) return;
    if (isDemo)
      store.transact((snapshot) => {
        snapshot.settings.campaignTemplates = next;
      });
    else {
      await studioCommand("settings", {
        command: "update",
        expectedVersion: 1,
        payload: { settings: { campaignTemplates: next } },
        reason: "Coach updated campaign templates",
      });
      await queryClient.invalidateQueries({ queryKey: ["studio"] });
    }
  };
  const saveTemplate = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || unknown.length) return;
    setBusy(true);
    try {
      const id = selectedId || crypto.randomUUID();
      const next = [
        ...templates.filter((item) => item.id !== id),
        {
          id,
          name: draft.name.trim(),
          subject: draft.subject.trim(),
          body: draft.body.trim(),
        },
      ];
      await saveTemplates(next);
      setSelectedId(id);
      setNotice("Template saved. You can reuse it for future campaigns.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Template could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const deleteTemplate = async () => {
    if (
      !selectedId ||
      busy ||
      !window.confirm(
        "Delete this saved template? Campaigns already queued will remain unchanged.",
      )
    )
      return;
    setBusy(true);
    try {
      await saveTemplates(templates.filter((item) => item.id !== selectedId));
      selectTemplate("");
      setNotice("Template deleted.");
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Template could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (busy || isDemo || !reviewing || !recipients.length || unknown.length)
      return;
    setBusy(true);
    try {
      const campaign = await queueCampaign({
        idempotencyKey: sendKey,
        name: draft.name.trim(),
        subject: draft.subject.trim(),
        body: draft.body.trim(),
      });
      setNotice(
        `${campaign.recipientCount} email${campaign.recipientCount === 1 ? "" : "s"} queued. Delivery will begin through the studio email connection.`,
      );
      setReviewing(false);
      setSendKey(crypto.randomUUID());
      try {
        setOverview(await loadCampaignOverview());
      } catch {
        setNotice(
          `${campaign.recipientCount} emails queued. Refresh the list to see delivery progress.`,
        );
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "Campaign could not be queued.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="loading">Opening campaigns…</div>;
  return (
    <div className="page campaigns-page">
      <PageHeader title="Campaigns">
        Send one personalized email to every contact address on the mailing
        list.
      </PageHeader>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      <div className="campaigns-summary">
        <article>
          <Users />
          <strong>{loading ? "…" : recipients.length}</strong>
          <span>receiving campaigns</span>
        </article>
        <article>
          <Mail />
          <strong>{loading ? "…" : optedOut}</strong>
          <span>unsubscribed</span>
        </article>
        <article>
          <Send />
          <strong>{overview?.campaigns.length || 0}</strong>
          <span>recent campaigns</span>
        </article>
      </div>
      <div className="campaigns-grid">
        <Section title="Compose campaign" marked>
          <p className="section-intro">
            Write a reusable template, preview the personalized message, then
            review the mailing-list count before queuing delivery.
          </p>
          <div className="campaign-template-picker">
            <label>
              Saved template
              <select
                value={selectedId}
                onChange={(event) => selectTemplate(event.target.value)}
              >
                <option value="">New template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => selectTemplate("")}>
              <Plus /> New
            </button>
          </div>
          <form
            className="settings-form campaign-composer"
            onSubmit={saveTemplate}
          >
            <label className="full">
              Campaign / template name
              <input
                required
                maxLength={120}
                value={draft.name}
                onChange={(event) => editDraft({ name: event.target.value })}
                placeholder="Fall studio update"
              />
            </label>
            <label className="full">
              Subject
              <input
                required
                maxLength={200}
                value={draft.subject}
                onChange={(event) => editDraft({ subject: event.target.value })}
                placeholder="Hi {{firstName}}, here’s what’s new"
              />
            </label>
            <label className="full">
              Email body
              <textarea
                required
                rows={11}
                maxLength={10000}
                value={draft.body}
                onChange={(event) => editDraft({ body: event.target.value })}
                placeholder={
                  "Hi {{firstName}},\n\nHere is what’s happening at {{studioName}}…"
                }
              />
            </label>
            <p className="campaign-token-help full">
              Personalize with{" "}
              {
                "{{firstName}}, {{fullName}}, {{email}}, {{studioName}}, {{portalUrl}}, {{unsubscribeUrl}}"
              }
              . An unsubscribe link is added automatically if you leave it out.
            </p>
            {unknown.length > 0 && (
              <p className="inline-error full">
                Unknown fields: {unknown.join(", ")}
              </p>
            )}
            <div className="form-actions full">
              {selectedId && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void deleteTemplate()}
                >
                  <Trash2 /> Delete template
                </button>
              )}
              <button type="submit" disabled={busy || unknown.length > 0}>
                {busy ? "Saving…" : "Save template"}
              </button>
              <button
                type="button"
                className="primary"
                disabled={
                  busy ||
                  loading ||
                  !recipients.length ||
                  unknown.length > 0 ||
                  !draft.name.trim() ||
                  !draft.subject.trim() ||
                  !draft.body.trim()
                }
                onClick={() => setReviewing(true)}
              >
                Review send
              </button>
            </div>
          </form>
        </Section>
        <div className="campaigns-side">
          <Section title="Recipient preview">
            <p className="section-intro">
              Addresses from students, guardian records, and linked contacts are
              deduplicated. Unsubscribed addresses are excluded.
            </p>
            {loading ? (
              <p>Loading mailing list…</p>
            ) : recipients.length ? (
              <ul className="campaign-recipient-list">
                {recipients.slice(0, 6).map((contact) => (
                  <li key={contact.email}>
                    <strong>{contact.name}</strong>
                    <small>{contact.email}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No subscribed addresses are available.</p>
            )}
            {recipients.length > 6 && (
              <small>And {recipients.length - 6} more recipients.</small>
            )}
          </Section>
          <Section title="Email preview">
            <div className="campaign-email-preview">
              <small>To: {previewValues.email}</small>
              <strong>
                {renderCampaignTemplate(
                  draft.subject || "Your subject",
                  previewValues,
                )}
              </strong>
              <p>
                {renderCampaignTemplate(
                  draft.body || "Your message will appear here.",
                  previewValues,
                )}
              </p>
              {!draft.body.includes("{{unsubscribeUrl}}") && (
                <small>
                  Unsubscribe from studio email campaigns:{" "}
                  {previewValues.unsubscribeUrl}
                </small>
              )}
            </div>
          </Section>
        </div>
      </div>
      {reviewing && (
        <section
          className="campaign-send-review"
          aria-label="Review campaign send"
        >
          <div>
            <strong>
              Ready to email {recipients.length} unique address
              {recipients.length === 1 ? "" : "es"}?
            </strong>
            <p>
              Each message is personalized and includes an unsubscribe link. The
              studio outbox will deliver them in batches.
            </p>
          </div>
          <button type="button" onClick={() => setReviewing(false)}>
            Back to edit
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy || isDemo}
            onClick={() => void send()}
          >
            {isDemo
              ? "Sending unavailable in demo"
              : busy
                ? "Queuing…"
                : `Queue ${recipients.length} emails`}
          </button>
        </section>
      )}
      <Section title="Recent campaigns">
        <div className="campaign-history">
          {overview?.campaigns.map((campaign) => (
            <article key={campaign.id}>
              <div>
                <strong>{campaign.name}</strong>
                <small>
                  {campaign.subject_template} ·{" "}
                  {new Date(campaign.created_at).toLocaleString()}
                </small>
              </div>
              <div>
                <Status
                  tone={
                    Number(campaign.failed_count)
                      ? "warn"
                      : Number(campaign.queued_count)
                        ? "neutral"
                        : "good"
                  }
                >
                  {Number(campaign.sent_count)} sent ·{" "}
                  {Number(campaign.queued_count)} queued
                  {Number(campaign.failed_count)
                    ? ` · ${Number(campaign.failed_count)} retrying`
                    : ""}
                  {Number(campaign.cancelled_count)
                    ? ` · ${Number(campaign.cancelled_count)} unsubscribed`
                    : ""}
                </Status>
              </div>
            </article>
          ))}
          {!overview?.campaigns.length && (
            <p>No campaigns have been sent yet.</p>
          )}
        </div>
        {!isDemo && (
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void loadCampaignOverview()
                .then(setOverview)
                .catch((error) =>
                  setNotice(
                    error instanceof Error
                      ? error.message
                      : "Could not refresh campaigns.",
                  ),
                )
                .finally(() => setLoading(false));
            }}
          >
            <RefreshCw /> Refresh list
          </button>
        )}
      </Section>
    </div>
  );
}
