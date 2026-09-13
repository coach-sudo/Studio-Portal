import { useState, type FormEvent } from "react";
import { Section, Toggle } from "../../components/Primitives";
import { DailyPopupCard } from "../../components/DailyPopup";
import { uploadStudioFile } from "../../data/uploads";
import type { StudioSettings as Settings } from "../../domain/model";

export function DailyPopupForm({
  value,
  studioId,
  isDemo,
  onSave,
}: {
  value: Settings["dailyPopup"];
  studioId: string;
  isDemo: boolean;
  onSave: (value: Settings["dailyPopup"]) => void;
}) {
  const [form, setForm] = useState(value);
  const [backgroundFile, setBackgroundFile] = useState<File>();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (uploading) return;
    setError("");
    setUploading(true);
    try {
      let next = form;
      if (backgroundFile) {
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(
            backgroundFile.type,
          ) ||
          backgroundFile.size > 5 * 1024 * 1024
        )
          throw new Error(
            "Choose a JPG, PNG, or WebP image smaller than 5 MB.",
          );
        const uploaded = await uploadStudioFile({
          studioId,
          entityType: "studio",
          file: backgroundFile,
          visibility: "public_actor",
        });
        next = {
          ...form,
          backgroundImageStoragePath: uploaded.storagePath,
          backgroundImageUrl: uploaded.signedUrl || "",
        };
        setForm(next);
        setBackgroundFile(undefined);
      }
      onSave(next);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Background image could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  };
  return (
    <Section title="Daily portal popup" marked>
      <p className="section-intro">
        Students and linked contacts see this when they first open their portal
        each day. They can close it immediately, and it stays hidden as they
        move between pages.
      </p>
      <form className="settings-form" onSubmit={(event) => void submit(event)}>
        {error && (
          <p className="inline-error full" role="alert">
            {error}
          </p>
        )}
        <div className="settings-list full">
          <Toggle
            label="Show daily popup"
            detail="Turn this off whenever you want to pause the message."
            checked={form.enabled}
            onChange={(enabled) => setForm({ ...form, enabled })}
          />
        </div>
        <label className="full">
          Heading
          <input
            required={form.enabled}
            maxLength={120}
            value={form.heading}
            onChange={(event) =>
              setForm({ ...form, heading: event.target.value })
            }
            placeholder="What would you like everyone to see?"
          />
        </label>
        <label className="full">
          Body
          <textarea
            required={form.enabled}
            rows={5}
            maxLength={1600}
            value={form.body}
            onChange={(event) => setForm({ ...form, body: event.target.value })}
            placeholder="Share your update here."
          />
        </label>
        <label>
          Background color
          <input
            type="color"
            value={form.backgroundColor}
            onChange={(event) =>
              setForm({ ...form, backgroundColor: event.target.value })
            }
          />
        </label>
        <label>
          Background image URL (optional)
          <input
            type="url"
            pattern="https://.*"
            value={
              form.backgroundImageStoragePath ? "" : form.backgroundImageUrl
            }
            onChange={(event) =>
              setForm({
                ...form,
                backgroundImageStoragePath: undefined,
                backgroundImageUrl: event.target.value,
              })
            }
            placeholder="https://…"
          />
        </label>
        <label className="full material-upload">
          Or upload a background image
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={isDemo}
            onChange={(event) => setBackgroundFile(event.target.files?.[0])}
          />
          <small>
            {isDemo
              ? "Image uploads are available in the live studio."
              : "JPG, PNG, or WebP up to 5 MB."}
          </small>
        </label>
        {(form.backgroundImageUrl || form.backgroundImageStoragePath) && (
          <div className="form-actions full">
            <button
              type="button"
              onClick={() => {
                setForm({
                  ...form,
                  backgroundImageUrl: "",
                  backgroundImageStoragePath: undefined,
                });
                setBackgroundFile(undefined);
              }}
            >
              Remove background image
            </button>
          </div>
        )}
        <label>
          Text color
          <select
            value={form.textTone}
            onChange={(event) =>
              setForm({
                ...form,
                textTone: event.target
                  .value as Settings["dailyPopup"]["textTone"],
              })
            }
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          Text alignment
          <select
            value={form.alignment}
            onChange={(event) =>
              setForm({
                ...form,
                alignment: event.target
                  .value as Settings["dailyPopup"]["alignment"],
              })
            }
          >
            <option value="center">Centered</option>
            <option value="left">Left aligned</option>
          </select>
        </label>
        <label>
          Style
          <select
            value={form.style}
            onChange={(event) =>
              setForm({
                ...form,
                style: event.target.value as Settings["dailyPopup"]["style"],
              })
            }
          >
            <option value="simple">Simple</option>
            <option value="framed">Framed</option>
          </select>
        </label>
        <div className="full">
          <DailyPopupCard popup={form} preview />
        </div>
        <div className="form-actions full">
          <button className="primary" disabled={uploading}>
            {uploading ? "Saving…" : "Save daily popup"}
          </button>
        </div>
      </form>
    </Section>
  );
}
