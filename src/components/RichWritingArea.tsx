import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cleanWritingHtml } from "../lib/writingHtml";
import "./WritingArea.css";

const controls = [
  ["undo", "Undo", "Undo"],
  ["redo", "Redo", "Redo"],
  ["formatBlock", "Heading", "Heading", "h3"],
  ["bold", "Bold", "B"],
  ["italic", "Italic", "I"],
  ["underline", "Underline", "U"],
  ["insertUnorderedList", "Bulleted list", "Bullets"],
  ["insertOrderedList", "Numbered list", "Numbers"],
] as const;

export function RichWritingArea({
  initialHtml,
  initialText = "",
  label,
  preserveInlineStyles,
  disabled,
  onChange,
  actions,
}: {
  initialHtml?: string;
  initialText?: string;
  label: string;
  preserveInlineStyles?: boolean;
  disabled?: boolean;
  onChange: (value: { html: string; text: string }) => void;
  actions?: ReactNode;
}) {
  const id = useId();
  const editor = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const linkField = useRef<HTMLInputElement>(null);
  const [initial] = useState({ html: initialHtml, text: initialText });
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState("");
  const linkOpen = link !== null;
  useLayoutEffect(() => {
    if (linkOpen) linkField.current?.focus();
  }, [linkOpen]);
  useLayoutEffect(() => {
    const field = editor.current;
    if (!field) return;
    if (initial.html)
      field.innerHTML = cleanWritingHtml(initial.html, preserveInlineStyles);
    else field.textContent = initial.text;
    savedRange.current = null;
  }, [initial, preserveInlineStyles]);

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (
      !selection?.rangeCount ||
      !editor.current?.contains(selection.anchorNode) ||
      !editor.current.contains(selection.focusNode)
    )
      return;
    savedRange.current = selection.getRangeAt(0).cloneRange();
  };
  const read = () => {
    const field = editor.current;
    if (!field) return;
    rememberSelection();
    onChange({
      html: cleanWritingHtml(field.innerHTML, preserveInlineStyles),
      text: field.innerText ?? field.textContent ?? "",
    });
  };
  const format = (command: string, value?: string) => {
    const field = editor.current;
    if (!field || disabled) return;
    if (document.activeElement !== field) field.focus();
    const selection = window.getSelection();
    const range = savedRange.current;
    if (selection && range && field.contains(range.commonAncestorContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    document.execCommand(command, false, value);
    read();
  };
  const insertLink = () => {
    if (!link) return;
    let href: URL;
    try {
      href = new URL(link.trim());
      if (href.protocol !== "https:" && href.protocol !== "http:")
        throw Error();
    } catch {
      setLinkError(
        "Enter a complete web address beginning with https:// or http://.",
      );
      return;
    }
    if (savedRange.current?.collapsed !== false) {
      const anchor = document.createElement("a");
      anchor.href = href.href;
      anchor.textContent = href.href;
      format("insertHTML", anchor.outerHTML);
    } else {
      format("createLink", href.href);
    }
    setLink(null);
    setLinkError("");
  };
  return (
    <div className="rich-editor writing-rich">
      <span id={id} className="visually-hidden">
        {label}
      </span>
      <div
        className="rich-toolbar"
        role="group"
        aria-label={label + " formatting"}
      >
        {controls.map(([command, name, text, value]) => (
          <button
            key={command}
            type="button"
            aria-label={name}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format(command, value)}
          >
            {text}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          aria-expanded={link !== null}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            rememberSelection();
            setLink(link === null ? "" : null);
            setLinkError("");
          }}
        >
          Link
        </button>
        {actions}
      </div>
      {link !== null && (
        <div className="writing-link">
          <label htmlFor={id + "-url"}>
            Web address
            <input
              id={id + "-url"}
              ref={linkField}
              type="url"
              aria-invalid={!!linkError}
              aria-describedby={linkError ? id + "-link-error" : undefined}
              value={link}
              onChange={(event) => {
                setLink(event.target.value);
                setLinkError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  insertLink();
                }
              }}
            />
          </label>
          <button type="button" onClick={insertLink}>
            Insert link
          </button>
          <button
            type="button"
            onClick={() => {
              setLink(null);
              editor.current?.focus();
            }}
          >
            Cancel link
          </button>
          {linkError && (
            <p id={id + "-link-error"} role="alert">
              {linkError}
            </p>
          )}
        </div>
      )}
      <div
        ref={editor}
        className="rich-editor-body"
        contentEditable={!disabled}
        role="textbox"
        tabIndex={disabled ? -1 : 0}
        aria-labelledby={id}
        aria-multiline="true"
        aria-readonly={disabled || undefined}
        data-placeholder="Write here…"
        onInput={read}
        onBlur={rememberSelection}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
        onTouchEnd={rememberSelection}
        onDrop={(event) => event.preventDefault()}
        onPaste={(event) => {
          event.preventDefault();
          rememberSelection();
          const text = event.clipboardData.getData("text/plain");
          if (text) format("insertText", text);
        }}
      />
    </div>
  );
}
