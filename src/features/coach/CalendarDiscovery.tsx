import {
  useId,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Dialog, Section } from "../../components/Primitives";
import {
  listAccessibleCalendars,
  startCalendarDiscovery,
  continueCalendarDiscovery,
  loadDiscoveryProgress,
  listSavedDiscoveries,
} from "../../data/calendarDiscovery";
import type {
  AccessibleCalendar,
  DiscoveryPageRequest,
  DiscoveryProgress,
  SavedDiscoveries,
} from "../../domain/calendarDiscovery";
import { zonedInputInstants } from "../../domain/zonedInput";
import { observedTimezone } from "../../domain/presentation";
import {
  DiscoveryProgressView,
  SavedDiscoveryView,
} from "./CalendarDiscoveryViews";
import "./CalendarDiscovery.css";

const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The preview could not be updated. Your input and saved progress are retained.";
export function CalendarDiscovery({ timezone }: { timezone: string }) {
  const id = useId(),
    [open, setOpen] = useState(false),
    [view, setView] = useState<"create" | "progress" | "saved">("create");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [fromFold, setFromFold] = useState(""),
    [toFold, setToFold] = useState("");
  const [calendars, setCalendars] = useState<AccessibleCalendar[]>([]),
    [calendarCursor, setCalendarCursor] = useState<string | null>(null),
    [calendarLoaded, setCalendarLoaded] = useState(false),
    [selected, setSelected] = useState<string[]>([]);
  const [scanId, setScanId] = useState(""),
    [progress, setProgress] = useState<DiscoveryProgress>(),
    [saved, setSaved] = useState<SavedDiscoveries>();
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const guard = useRef(false),
    keys = useRef(new Map<string, string>()),
    pending = useRef(
      new Map<string, { payload: DiscoveryPageRequest; key: string }>(),
    ),
    [, refreshPending] = useState(0);
  const validZone = (() => {
    try {
      if (!timezone) return false;
      Intl.DateTimeFormat("en", { timeZone: timezone }).format();
      return true;
    } catch {
      return false;
    }
  })();
  const keyFor = (value: unknown) => {
    const signature = JSON.stringify(value),
      key = keys.current.get(signature) || crypto.randomUUID();
    keys.current.set(signature, key);
    return key;
  };
  const perform = async (name: string, action: () => Promise<void>) => {
    if (guard.current) return;
    guard.current = true;
    setBusy(name);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
      guard.current = false;
    }
  };
  const readProgress = async (target: string, cursor?: string) => {
    const next = await loadDiscoveryProgress(target, cursor);
    setProgress((current) =>
      cursor && current?.scanId === target
        ? {
            ...next,
            items: [
              ...new Map(
                [...current.items, ...next.items].map((item) => [
                  item.id,
                  item,
                ]),
              ).values(),
            ],
          }
        : next,
    );
  };
  const readSaved = async (cursor?: SavedDiscoveries["nextCursor"]) => {
    const next = await listSavedDiscoveries(cursor);
    setSaved((current) =>
      cursor && current
        ? {
            ...next,
            items: [
              ...new Map(
                [...current.items, ...next.items].map((item) => [
                  item.scanId,
                  item,
                ]),
              ).values(),
            ],
          }
        : next,
    );
  };
  const show = (event: MouseEvent<HTMLButtonElement>, next: typeof view) => {
    event.currentTarget.focus();
    setView(next);
    setOpen(true);
    setError("");
    if (next === "saved") void perform("history", () => readSaved());
  };
  const loadCalendars = (cursor?: string) =>
    void perform("calendars", async () => {
      const page = await listAccessibleCalendars(cursor);
      setCalendars((current) => [
        ...new Map(
          [
            ...(cursor
              ? current
              : current.filter((item) => selected.includes(item.id))),
            ...page.items,
          ].map((item) => [item.id, item]),
        ).values(),
      ]);
      setCalendarCursor(page.nextCursor);
      setCalendarLoaded(true);
    });
  const start = async (event: FormEvent) => {
    event.preventDefault();
    await perform("save", async () => {
      const choose = (wall: string, fold: string) => {
          const values = zonedInputInstants(wall, timezone);
          return values.length === 1
            ? values[0]
            : values.find((v) => v === fold);
        },
        a = choose(from, fromFold),
        b = choose(to, toFold);
      if (!a || !b || Date.parse(b) <= Date.parse(a))
        throw new Error(
          "Choose a valid increasing range. A DST gap does not exist; a repeated hour needs an explicit occurrence choice.",
        );
      if (!selected.length)
        throw new Error("Select at least one accessible calendar.");
      if (selected.length > 100)
        throw new Error(
          "Select up to 100 calendars in one preview. Additional calendars can use another preview.",
        );
      const chosen = selected.map((calendarId) => {
        const calendar = calendars.find((item) => item.id === calendarId);
        if (!calendar || !calendar.selectable)
          throw new Error(
            "Review the selected calendars: an event read permission is unavailable.",
          );
        return calendar;
      });
      const payload = {
        from: a,
        to: b,
        timezone,
        calendars: chosen
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((c) => ({ id: c.id, label: c.label, timezone: c.timezone })),
      };
      const result = await startCalendarDiscovery(
        payload,
        keyFor({ command: "start", payload }),
      );
      setScanId(result.scanId);
      setView("progress");
      setProgress(undefined);
      await readProgress(result.scanId);
    });
  };
  const readPage = (source: DiscoveryProgress["sources"][number]) =>
    void perform("page", async () => {
      const identity = `${scanId}:${source.calendarId}`,
        retained = pending.current.get(identity),
        payload = retained?.payload || {
          scanId,
          calendarId: source.calendarId,
          pageSequence: source.pageSequence,
        },
        key = retained?.key || keyFor({ command: "page", payload });
      pending.current.set(identity, { payload, key });
      refreshPending((n) => n + 1);
      try {
        await continueCalendarDiscovery(payload, key);
        pending.current.delete(identity);
        refreshPending((n) => n + 1);
      } catch (e) {
        try {
          await readProgress(scanId);
        } catch {
          throw new Error(
            `${errorText(e)} Progress could not refresh. Retry unchanged to recover the saved receipt.`,
          );
        }
        throw e;
      }
      await readProgress(scanId);
    });
  const timeField = (
    label: string,
    value: string,
    setValue: Dispatch<SetStateAction<string>>,
    fold: string,
    setFold: Dispatch<SetStateAction<string>>,
  ) => {
    const field = id + label,
      values = zonedInputInstants(value, timezone);
    return (
      <div>
        <label htmlFor={field}>
          {label}
          <input
            id={field}
            required
            type="datetime-local"
            value={value}
            disabled={!!busy}
            onChange={(e) => {
              setValue(e.target.value);
              setFold("");
            }}
          />
        </label>
        {values.length > 1 && (
          <>
            <label htmlFor={field + "-fold"}>
              {label} repeated-hour occurrence
              <select
                id={field + "-fold"}
                required
                value={fold}
                disabled={!!busy}
                onChange={(e) => setFold(e.target.value)}
              >
                <option value="">Choose occurrence</option>
                {values.map((value, index) => (
                  <option key={value} value={value}>
                    {index === 0 ? "First" : "Second"} occurrence
                  </option>
                ))}
              </select>
            </label>
            <small>UTC choices: {values.join(" or ")}</small>
          </>
        )}
      </div>
    );
  };
  return (
    <Section title="Calendar discovery">
      <p>
        Preview selected calendars and dates. Review source evidence before
        linking or recording a lesson.
      </p>
      <div className="form-actions">
        <button
          type="button"
          onClick={(e) => show(e, scanId ? "progress" : "create")}
        >
          Calendar discovery previews
        </button>
        <button type="button" onClick={(e) => show(e, "saved")}>
          Saved Calendar previews
        </button>
      </div>
      {open && (
        <Dialog
          key={view}
          className="calendar-discovery-dialog"
          title={
            view === "create"
              ? "Preview Calendar events"
              : view === "progress"
                ? "Calendar preview progress"
                : "Saved Calendar previews"
          }
          description="Source preview for coach review."
          onClose={() => setOpen(false)}
        >
          {error && (
            <p className="inline-error workflow-content" role="alert">
              {error}
            </p>
          )}
          <div className="workflow-content header-actions discovery-navigation">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => setView("create")}
            >
              New preview
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => {
                setView("saved");
                void perform("history", () => readSaved());
              }}
            >
              Browse saved previews
            </button>
            {busy && (
              <p role="status">
                {busy === "page"
                  ? "Reading one Calendar page…"
                  : busy === "save"
                    ? "Saving preview request…"
                    : "Loading preview information…"}
              </p>
            )}
          </div>
          {view === "create" && (
            <form className="workflow-form" onSubmit={start}>
              <p className="full">
                Range timezone: {timezone || "not configured"}. Viewer timezone:{" "}
                {observedTimezone()}.
              </p>
              {!validZone && (
                <p className="inline-error full" role="alert">
                  Choose a valid studio timezone in Settings before saving a
                  preview.
                </p>
              )}
              {timeField("From", from, setFrom, fromFold, setFromFold)}
              {timeField("Until", to, setTo, toFold, setToFold)}
              <p className="full">
                Events overlapping this range are included. The end is
                exclusive. Historical ranges are permitted.
              </p>
              <div className="header-actions full">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => loadCalendars()}
                >
                  Load accessible calendars
                </button>
              </div>
              <fieldset className="full discovery-calendar-options">
                <legend>Select calendars</legend>
                {calendars.map((calendar) => (
                  <label
                    className="check-row"
                    htmlFor={id + calendar.id}
                    key={calendar.id}
                  >
                    <input
                      id={id + calendar.id}
                      type="checkbox"
                      checked={selected.includes(calendar.id)}
                      disabled={
                        !!busy ||
                        (!calendar.selectable &&
                          !selected.includes(calendar.id))
                      }
                      onChange={(e) =>
                        setSelected((current) =>
                          e.target.checked
                            ? [...current, calendar.id]
                            : current.filter((value) => value !== calendar.id),
                        )
                      }
                    />
                    <span>
                      {calendar.label}
                      {calendar.primary ? " · primary" : ""}
                      {!calendar.selectable
                        ? " · event read access unavailable"
                        : ""}
                    </span>
                  </label>
                ))}
                {calendarLoaded && !calendars.length && (
                  <p>
                    No accessible calendars were returned. Review Google
                    permissions and retry.
                  </p>
                )}
                {!calendarLoaded && (
                  <p>Load calendars to choose the sources for this preview.</p>
                )}
              </fieldset>
              {calendarCursor && (
                <div className="full">
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => loadCalendars(calendarCursor)}
                  >
                    Load more calendars
                  </button>
                </div>
              )}
              <p className="full">
                {selected.length} calendars selected. Saving creates a preview
                request; each source page is read separately.
              </p>
              <div className="form-actions full">
                <button
                  className="primary"
                  disabled={!!busy || !validZone || !selected.length}
                >
                  Save preview request
                </button>
              </div>
            </form>
          )}
          {view === "progress" &&
            (progress ? (
              <DiscoveryProgressView
                data={progress}
                busy={!!busy}
                pending={
                  new Set(
                    [...pending.current.values()]
                      .filter((item) => item.payload.scanId === scanId)
                      .map((item) => item.payload.calendarId),
                  )
                }
                onRead={readPage}
                onRefresh={() =>
                  void perform("progress", () => readProgress(scanId))
                }
                onMore={() =>
                  progress.nextCursor &&
                  void perform("progress", () =>
                    readProgress(scanId, progress.nextCursor!),
                  )
                }
              />
            ) : (
              <div className="workflow-content">
                <p>
                  Preview request saved. Refresh to read its actual progress.
                </p>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() =>
                    void perform("progress", () => readProgress(scanId))
                  }
                >
                  Refresh preview progress
                </button>
              </div>
            ))}
          {view === "saved" &&
            (saved ? (
              <SavedDiscoveryView
                data={saved}
                busy={!!busy}
                onOpen={(target) => {
                  setScanId(target);
                  setProgress(undefined);
                  setView("progress");
                  void perform("progress", () => readProgress(target));
                }}
                onMore={() =>
                  void perform("history", () => readSaved(saved.nextCursor))
                }
              />
            ) : (
              <div className="workflow-content">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => void perform("history", () => readSaved())}
                >
                  Load saved previews
                </button>
              </div>
            ))}
        </Dialog>
      )}
    </Section>
  );
}
