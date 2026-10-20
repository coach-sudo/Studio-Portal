import { WritingArea } from "./WritingArea";
import { useEffect, useState } from "react";
import type { Assignment } from "../domain/model";

export function AssignmentActivity({
  assignment,
  busy,
  onSave,
  onComplete,
  onHelp,
  readOnly = false,
}: {
  assignment: Assignment;
  busy: boolean;
  onSave: (responses: Record<string, unknown>) => Promise<void>;
  onComplete: () => void;
  onHelp: () => void;
  readOnly?: boolean;
}) {
  const [responses, setResponses] = useState<Record<string, unknown>>(
    assignment.responses || {},
  );
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    setResponses(assignment.responses || {});
    setDirty(false);
  }, [assignment.id, assignment.version]);
  const type = assignment.activityType || "instruction";
  const config = assignment.activityConfig || {};
  const set = (key: string, value: unknown) => {
    if (readOnly) return;
    setResponses((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  return (
    <div className="assignment-activity">
      <p className="assignment-instructions">{assignment.details}</p>
      {type === "journal" && (
        <label>
          Your reflection
          <WritingArea
            readOnly={readOnly}
            rows={6}
            value={String(responses.journal || "")}
            onChange={(event) => set("journal", event.target.value)}
            placeholder="Write freely here. You can save and return later."
          />
        </label>
      )}
      {type === "qa" &&
        (config.prompts || []).map((prompt, index) => (
          <label key={`${prompt}-${index}`}>
            {prompt}
            <WritingArea
              readOnly={readOnly}
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
                disabled={readOnly}
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
                disabled={readOnly}
                type="checkbox"
                checked={Boolean(responses[`item-${index}`])}
                onChange={(event) => set(`item-${index}`, event.target.checked)}
              />
              <span>{item}</span>
            </label>
          ))}
        </div>
      )}
      {!readOnly && (
        <div className="form-actions assignment-actions">
          {type !== "instruction" && (
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => void onSave(responses).then(() => setDirty(false))}
            >
              {busy ? "Saving…" : dirty ? "Save progress" : "Progress saved"}
            </button>
          )}
          {assignment.status !== "completed" && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={onComplete}
            >
              Complete &amp; archive
            </button>
          )}
          <button
            type="button"
            disabled={busy || assignment.helpRequested}
            onClick={onHelp}
          >
            {assignment.helpRequested ? "Help requested" : "Ask coach"}
          </button>
        </div>
      )}
    </div>
  );
}
