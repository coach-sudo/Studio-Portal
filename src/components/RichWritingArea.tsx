import { EditorContent, useEditor } from "@tiptap/react";
import { Mark, type Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { cleanWritingHtml } from "../lib/writingHtml";
import "./WritingArea.css";

const extensions = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    trailingNode: false,
    heading: { levels: [2, 3, 4] },
    link: { openOnClick: false, autolink: false },
  }),
];

// Preserve existing coach note typography when reopening older HTML for editing.
// These text-only properties cannot reference external content.
const legacyStyle = Mark.create({
  name: "legacyWritingStyle",
  addAttributes() {
    return { style: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: "span[style]",
        getAttrs: (element) => {
          const properties = [
            "color",
            "background-color",
            "font-family",
            "font-size",
            "font-weight",
            "font-style",
            "text-decoration-line",
          ];
          const style = properties
            .flatMap((property) => {
              const value = element.style.getPropertyValue(property);
              return value && !/url\s*\(|var\s*\(/i.test(value)
                ? [`${property}: ${value}`]
                : [];
            })
            .join("; ");
          return style ? { style } : false;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", HTMLAttributes, 0];
  },
});

function previousNumber(editor: Editor) {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name !== "orderedList") continue;
    const parent = $from.node(depth - 1);
    for (let index = $from.index(depth - 1) - 1; index >= 0; index--) {
      const node = parent.child(index);
      if (node.type.name === "orderedList")
        return Number(node.attrs.start ?? 1) + node.childCount;
    }
    return null;
  }
  return null;
}

export function RichWritingArea({
  initialHtml,
  initialText = "",
  label,
  preserveInlineStyles,
  professional,
  disabled,
  onChange,
  actions,
}: {
  initialHtml?: string;
  initialText?: string;
  label: string;
  preserveInlineStyles?: boolean;
  professional?: boolean;
  disabled?: boolean;
  onChange: (value: { html: string; text: string }) => void;
  actions?: ReactNode;
}) {
  const id = useId();
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState("");
  const linkField = useRef<HTMLInputElement>(null);
  const linkOpen = link !== null;
  const editor = useEditor({
    extensions: preserveInlineStyles
      ? [...extensions, legacyStyle]
      : extensions,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editable: !disabled,
    content: initialHtml
      ? cleanWritingHtml(initialHtml, preserveInlineStyles)
      : {
          type: "doc",
          content: initialText.split(/\r?\n/).map((text) => ({
            type: "paragraph",
            content: text ? [{ type: "text", text }] : [],
          })),
        },
    editorProps: {
      attributes: {
        class: "rich-editor-body",
        role: "textbox",
        "aria-labelledby": id,
        "aria-multiline": "true",
        "data-placeholder": "Write here…",
      },
      transformPastedHTML: (html) => cleanWritingHtml(html),
      handleDrop: () => true,
    },
    onUpdate: ({ editor: current }) =>
      onChange({
        html: current.getHTML(),
        text: current.getText({ blockSeparator: "\n" }),
      }),
  });
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled, false);
    editor.view.dom.setAttribute("aria-readonly", String(!!disabled));
    editor.view.dom.tabIndex = disabled ? -1 : 0;
  }, [disabled, editor]);
  useEffect(() => {
    if (linkOpen) linkField.current?.focus();
  }, [linkOpen]);

  const command = () =>
    editor!.chain().focus(undefined, { scrollIntoView: false });
  const keepSelection = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (!editor) return;
    const { view } = editor;
    const selection = view.dom.ownerDocument.getSelection();
    if (
      !selection?.anchorNode ||
      !selection.focusNode ||
      !view.dom.contains(selection.anchorNode) ||
      !view.dom.contains(selection.focusNode)
    )
      return;
    const from = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
    const to = view.posAtDOM(selection.focusNode, selection.focusOffset);
    if (
      from !== view.state.selection.anchor ||
      to !== view.state.selection.head
    )
      editor.commands.setTextSelection({ from, to });
  };
  const active = (name: string, attrs?: Record<string, unknown>) =>
    editor?.isActive(name, attrs) ?? false;
  const continueAt = editor && previousNumber(editor);
  const controls: {
    name: string;
    text?: string;
    pressed?: boolean;
    expanded?: boolean;
    unavailable?: boolean;
    apply: () => unknown;
  }[] = [
    {
      name: "Undo",
      unavailable: !editor?.can().undo(),
      apply: () => command().undo().run(),
    },
    {
      name: "Redo",
      unavailable: !editor?.can().redo(),
      apply: () => command().redo().run(),
    },
    ...(professional
      ? []
      : [
          {
            name: "Heading",
            pressed: active("heading", { level: 3 }),
            apply: () => command().toggleHeading({ level: 3 }).run(),
          },
        ]),
    {
      name: "Bold",
      text: "B",
      pressed: active("bold"),
      apply: () => command().toggleBold().run(),
    },
    {
      name: "Italic",
      text: "I",
      pressed: active("italic"),
      apply: () => command().toggleItalic().run(),
    },
    {
      name: "Underline",
      text: "U",
      pressed: active("underline"),
      apply: () => command().toggleUnderline().run(),
    },
    {
      name: "Bulleted list",
      text: "Bullets",
      pressed: active("bulletList"),
      apply: () => command().toggleBulletList().run(),
    },
    {
      name: "Numbered list",
      text: "Numbers",
      pressed: active("orderedList"),
      apply: () => command().toggleOrderedList().run(),
    },
    {
      name: "Link",
      expanded: linkOpen,
      pressed: active("link"),
      apply: () => {
        setLink(
          linkOpen ? null : String(editor?.getAttributes("link").href ?? ""),
        );
        setLinkError("");
      },
    },
  ];
  if (professional)
    controls.push(
      {
        name: "Paragraph",
        text: "¶",
        pressed: active("paragraph") && !active("listItem"),
        apply: () => command().setParagraph().run(),
      },
      ...([2, 3, 4] as const).map((level) => ({
        name: `Heading ${level}`,
        text: `H${level}`,
        pressed: active("heading", { level }),
        apply: () => command().toggleHeading({ level }).run(),
      })),
      {
        name: "Indent list item",
        text: "Indent",
        unavailable: !editor?.can().sinkListItem("listItem"),
        apply: () => command().sinkListItem("listItem").run(),
      },
      {
        name: "Outdent list item",
        text: "Outdent",
        unavailable: !editor?.can().liftListItem("listItem"),
        apply: () => command().liftListItem("listItem").run(),
      },
      {
        name: "Restart numbering",
        text: "Restart",
        unavailable: !active("orderedList"),
        apply: () =>
          command().updateAttributes("orderedList", { start: 1 }).run(),
      },
      {
        name: "Continue numbering",
        text: "Continue",
        unavailable: continueAt == null,
        apply: () =>
          command()
            .updateAttributes("orderedList", { start: continueAt })
            .run(),
      },
    );

  const insertLink = () => {
    let url: URL;
    try {
      url = new URL(link?.trim() ?? "");
      if (url.protocol !== "https:" && url.protocol !== "http:") throw Error();
    } catch {
      setLinkError(
        "Enter a complete web address beginning with https:// or http://.",
      );
      return;
    }
    const chain = command();
    if (editor!.state.selection.empty && !active("link"))
      chain
        .insertContent({
          type: "text",
          text: url.href,
          marks: [{ type: "link", attrs: { href: url.href } }],
        })
        .run();
    else chain.extendMarkRange("link").setLink({ href: url.href }).run();
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
        role={professional ? "toolbar" : "group"}
        aria-label={label + " formatting"}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          );
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault();
          buttons[
            (index + buttons.length + (event.key === "ArrowRight" ? 1 : -1)) %
              buttons.length
          ]?.focus();
        }}
      >
        {controls.map(
          ({ name, text, pressed, expanded, unavailable, apply }) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              aria-pressed={pressed}
              aria-expanded={expanded}
              disabled={!editor || disabled || unavailable}
              onMouseDown={keepSelection}
              onClick={apply}
            >
              {text ?? name}
            </button>
          ),
        )}
        {actions && <span className="writing-toolbar-actions">{actions}</span>}
      </div>
      {linkOpen && (
        <div className="writing-link">
          <label htmlFor={id + "-url"}>
            Web address
            <input
              id={id + "-url"}
              ref={linkField}
              type="url"
              aria-invalid={!!linkError}
              aria-describedby={linkError ? id + "-link-error" : undefined}
              value={link ?? ""}
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
          {active("link") && (
            <button
              type="button"
              onClick={() => {
                command().extendMarkRange("link").unsetLink().run();
                setLink(null);
              }}
            >
              Remove link
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setLink(null);
              editor?.commands.focus(undefined, { scrollIntoView: false });
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
      <EditorContent editor={editor} />
    </div>
  );
}
