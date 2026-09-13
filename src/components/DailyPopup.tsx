import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { StudioSettings } from "../domain/model";
import "./DailyPopup.css";

type Popup = StudioSettings["dailyPopup"];

export function popupDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function popupStorageKey(
  studioId: string,
  viewerId: string,
  date = new Date(),
) {
  return `studio-daily-popup:${studioId}:${viewerId}:${popupDayKey(date)}`;
}

function safeBackgroundImage(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function DailyPopupCard({
  popup,
  preview = false,
}: {
  popup: Popup;
  preview?: boolean;
}) {
  const image = safeBackgroundImage(popup.backgroundImageUrl);
  const overlay =
    popup.textTone === "dark" ? "rgba(255,255,255,.62)" : "rgba(0,0,0,.38)";
  return (
    <div
      className={`daily-popup-card daily-popup-${popup.style} daily-popup-${popup.alignment} daily-popup-${popup.textTone}`}
      style={{
        backgroundColor: /^#[0-9a-f]{6}$/i.test(popup.backgroundColor)
          ? popup.backgroundColor
          : "#173F35",
        backgroundImage: image
          ? `linear-gradient(${overlay}, ${overlay}), url("${image}")`
          : undefined,
      }}
    >
      {preview && <small className="daily-popup-kicker">Preview</small>}
      <h2>{popup.heading.trim() || "Your heading"}</h2>
      <p>{popup.body.trim() || "Your message will appear here."}</p>
    </div>
  );
}

export function DailyPopup({
  popup,
  studioId,
  viewerId,
}: {
  popup: Popup;
  studioId: string;
  viewerId: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!popup.enabled || !popup.heading.trim() || !popup.body.trim()) {
      setOpen(false);
      return;
    }
    const key = popupStorageKey(studioId, viewerId);
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "shown");
    } catch {
      // The popup still works if browser storage is disabled.
    }
    setOpen(true);
  }, [popup.enabled, popup.heading, popup.body, studioId, viewerId]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="daily-popup-backdrop"
      onMouseDown={(event) =>
        event.target === event.currentTarget && setOpen(false)
      }
    >
      <section
        className="daily-popup-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={popup.heading}
      >
        <DailyPopupCard popup={popup} />
        <button
          type="button"
          className="daily-popup-close"
          aria-label="Close announcement"
          onClick={() => setOpen(false)}
        >
          <X />
        </button>
      </section>
    </div>
  );
}
