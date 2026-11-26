import { WritingArea } from "./WritingArea";
import { RichWritingArea } from "./RichWritingArea";
import { cleanWritingHtml } from "../lib/writingHtml";
import { useEffect, useState } from "react";
import type { Assignment } from "../domain/model";
import { useUnsavedWorkspaceChanges } from "../hooks/useWorkspaceLocation";
import { ApiClientError } from "../data/apiClientError";
import { AssignmentAttachments } from "./AssignmentAttachments";

export function AssignmentActivity({
  assignment,
  busy,
  onSave,
  onComplete,
  onHelp,
  readOnly = false,
  attachmentStudioId,
}: {
  assignment: Assignment;
  busy: boolean;
  onSave: (responses: Record<string, unknown>) => Promise<void>;
  onComplete: () => void;
  onHelp: () => void;
  readOnly?: boolean;
  attachmentStudioId?: string;
}) {
  const [responses, setResponses] = useState<Record<string, unknown>>(
    assignment.responses || {},
  );
  const [dirty, setDirty] = useState(false);
  const [editingVersion, setEditingVersion] = useState(assignment.version);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [richJournal, setRichJournal] = useState(false);
  const [writeConflict, setWriteConflict] = useState(false);
  const [attachmentPending, setAttachmentPending] = useState(false);
  const conflict =
    dirty && (writeConflict || assignment.version !== editingVersion);
  useUnsavedWorkspaceChanges(
    !readOnly && (dirty || saving || attachmentPending),
  );
  useEffect(() => {
    if (dirty || saving) return;
    setResponses(assignment.responses || {});
    setEditingVersion(assignment.version);
  }, [assignment.id, assignment.responses, assignment.version, dirty, saving]);
  const type = assignment.activityType || "instruction";
  const config = assignment.activityConfig || {};
  const journal = String(responses.journal || "");
  const journalHtml =
    typeof responses.journalHtml === "string" ? responses.journalHtml : "";
  const showRichJournal = richJournal || !!journalHtml;
  const set = (key: string, value: unknown) => {
    if (readOnly || saving) return;
    setResponses((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setSaved(false);
  };
  const save = async () => {
    if (busy || saving || conflict || !dirty) return;
    setSaving(true);
    setSaveError("");
    try {
      await onSave(responses);
      setDirty(false);
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "VERSION_CONFLICT")
        setWriteConflict(true);
      else
        setSaveError(
          "Progress could not be confirmed. Your response is still here. Try saving again.",
        );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="assignment-activity">
      <p className="assignment-instructions">{assignment.details}</p>
      {type === "journal" &&
        (showRichJournal ? (
          readOnly ? (
            <div aria-label="Your reflection">
              {journalHtml ? (
                <div
                  dangerouslySetInnerHTML={{
                    __html: cleanWritingHtml(journalHtml),
                  }}
                />
              ) : (
                journal
              )}
            </div>
          ) : (
            <RichWritingArea
              key={editingVersion}
              label="Your reflection"
              disabled={busy || saving}
              initialHtml={journalHtml}
              initialText={journal}
              onChange={({ html, text }) => {
                setResponses((current) => ({
                  ...current,
                  journal: text,
                  journalHtml: html,
                }));
                setDirty(true);
                setSaved(false);
              }}
            />
          )
        ) : (
          <>
            <label>
              Your reflection
              <WritingArea
                readOnly={readOnly || saving}
                rows={6}
                value={journal}
                onChange={(event) => set("journal", event.target.value)}
                placeholder="Write freely here. You can save and return later."
              />
            </label>
            {!readOnly && (
              <button
                type="button"
                disabled={busy || saving}
                onClick={() => setRichJournal(true)}
              >
                Use formatting
              </button>
            )}
          </>
        ))}
      {type === "qa" &&
        (config.prompts || []).map((prompt, index) => (
          <label key={`${prompt}-${index}`}>
            {prompt}
            <WritingArea
              readOnly={readOnly || saving}
              rows={3}
              value={String(responses[`answer-${index}`] || "")}
              onChange={(event) => set(`answer-${index}`, event.target.value)}
            />
          </label>
        ))}
      {type === "multiple_choice" && (
        <fieldset className="option-fieldset">
          <legend>Choose one</legend>
          {(config.options || []).map((option, index) => (
            <label className="check-row" key={`${option}-${index}`}>
              <input
                disabled={readOnly || saving}
                type="radio"
                name={`assignment-${assignment.id}`}
                checked={responses.choice === option}
                onChange={() => set("choice", option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      )}
      {type === "checklist" && (
        <div className="assignment-checklist">
          {(config.items || []).map((item, index) => (
            <label className="check-row" key={`${item}-${index}`}>
              <input
                disabled={readOnly || saving}
                type="checkbox"
                checked={Boolean(responses[`item-${index}`])}
                onChange={(event) => set(`item-${index}`, event.target.checked)}
              />
              <span>{item}</span>
            </label>
          ))}
        </div>
      )}
      {attachmentStudioId &&
        (!readOnly || assignment.status === "completed") && (
          <AssignmentAttachments
            scope={{
              assignmentId: assignment.id,
              studentId: assignment.studentId,
              studioId: attachmentStudioId,
            }}
            canEdit={
              !readOnly &&
              ["assigned", "in_progress", "reopened"].includes(assignment.status)
            }
            disabled={busy || saving}
            onPendingChange={setAttachmentPending}
          />
        )}
      {!readOnly && (
        <div className="form-actions assignment-actions">
          {(conflict || saveError) && (
            <p role="alert">
              {conflict
                ? "This assignment changed while you were writing. Your response is still here. Open the latest assignment in another tab to reconcile your changes."
                : saveError}
            </p>
          )}
          <span role="status">
            {saving
              ? "Saving progress…"
              : saved
                ? "Progress saved"
                : dirty
                  ? "Unsaved changes"
                  : ""}
          </span>
          {type !== "instruction" && (
            <button
              type="button"
              disabled={busy || saving || conflict || !dirty}
              onClick={() => void save()}
            >
              {busy || saving ? "Saving…" : "Save progress"}
            </button>
          )}
          {assignment.status !== "completed" && (
            <button
              type="button"
              className="primary"
              disabled={busy || saving || dirty || attachmentPending}
              onClick={onComplete}
            >
              Complete &amp; archive
            </button>
          )}
          <button
            type="button"
            disabled={busy || saving || dirty || assignment.helpRequested}
            onClick={onHelp}
          >
            {assignment.helpRequested ? "Help requested" : "Ask coach"}
          </button>
        </div>
      )}
    </div>
  );
}
