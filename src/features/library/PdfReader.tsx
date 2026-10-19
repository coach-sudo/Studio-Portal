import { useEffect, useRef, useState } from "react";
import {
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { StudyAnchor } from "../../domain/library";

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfReader({
  url,
  anchor,
  zoom,
  onPosition,
  onFailure,
}: {
  url: string;
  anchor: StudyAnchor;
  zoom: number;
  onPosition: (anchor: StudyAnchor) => void;
  onFailure: () => void;
}) {
  const [document, setDocument] = useState<PDFDocumentProxy>(),
    [pageText, setPageText] = useState(""),
    [search, setSearch] = useState(""),
    [matches, setMatches] = useState<number[]>([]),
    [searchStatus, setSearchStatus] = useState(""),
    [busy, setBusy] = useState(true),
    [width, setWidth] = useState(700);
  const canvas = useRef<HTMLCanvasElement>(null),
    container = useRef<HTMLDivElement>(null),
    searchRun = useRef(0);
  const callbacks = useRef({ onFailure, onPosition });
  callbacks.current = { onFailure, onPosition };
  const page = Math.max(
    1,
    Math.min(anchor.page || 1, document?.numPages || Infinity),
  );
  useEffect(() => {
    let alive = true;
    setDocument(undefined);
    setBusy(true);
    setSearchStatus("");
    setMatches([]);
    // Canvas/text APIs only: no scripting manager, XFA, forms or annotation layer.
    const task = getDocument({
      url,
      enableXfa: false,
      useWasm: false,
      useSystemFonts: true,
      maxImageSize: 16000000,
    });
    void task.promise
      .then((pdf) => {
        if (alive) {
          setDocument(pdf);
          setBusy(false);
        }
      })
      .catch(() => {
        if (alive) callbacks.current.onFailure();
      });
    return () => {
      alive = false;
      searchRun.current++;
      void task.destroy();
    };
  }, [url]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(200, entries[0].contentRect.width - 16)),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!document) return;
    let alive = true,
      cancel = () => {};
    setBusy(true);
    setPageText("");
    void document
      .getPage(page)
      .then(async (pdfPage) => {
        if (!alive || !canvas.current) return;
        const base = pdfPage.getViewport({ scale: 1 }),
          dpr = Math.min(2, window.devicePixelRatio || 1);
        const scale = Math.min(
          (Math.min(width, 1000) / base.width) * zoom,
          Math.sqrt(16000000 / (base.width * base.height)) / dpr,
        );
        const viewport = pdfPage.getViewport({ scale });
        const element = canvas.current;
        element.width = Math.floor(viewport.width * dpr);
        element.height = Math.floor(viewport.height * dpr);
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        const render = pdfPage.render({
          canvas: element,
          viewport,
          transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
          annotationMode: AnnotationMode.DISABLE,
        });
        cancel = () => render.cancel();
        const text = await pdfPage.getTextContent();
        if (alive)
          setPageText(
            text.items.map((item) => ("str" in item ? item.str : "")).join(" "),
          );
        await render.promise;
        if (alive) setBusy(false);
      })
      .catch((error) => {
        if (alive && error?.name !== "RenderingCancelledException")
          callbacks.current.onFailure();
      });
    return () => {
      alive = false;
      cancel();
    };
  }, [document, page, zoom, width]);
  const find = async () => {
    if (!document || !search.trim()) return;
    const run = ++searchRun.current,
      found: number[] = [];
    let anyText = false;
    setSearchStatus("Searching…");
    setMatches([]);
    try {
      for (let n = 1; n <= document.numPages; n++) {
        if (run !== searchRun.current) return;
        const text = (await (await document.getPage(n)).getTextContent()).items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ");
        anyText ||= !!text.trim();
        if (
          text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
        )
          found.push(n);
        if (found.length >= 200) break;
      }
      if (run !== searchRun.current) return;
      setMatches(found);
      setSearchStatus(
        !anyText
          ? "Text search is unavailable in this image-only PDF."
          : found.length
            ? `${found.length === 200 ? "First " : ""}${found.length} matching pages`
            : "No matching text",
      );
      if (found[0]) callbacks.current.onPosition({ page: found[0] });
    } catch {
      if (run === searchRun.current)
        setSearchStatus("Search failed. Retry or open the original.");
    }
  };
  return (
    <div className="pdf-reader" ref={container}>
      <div className="viewer-toolbar" role="group" aria-label="PDF navigation">
        <button
          type="button"
          disabled={!document || page <= 1}
          onClick={() => onPosition({ page: page - 1 })}
        >
          Previous page
        </button>
        <label>
          Page{" "}
          <input
            type="number"
            min="1"
            max={document?.numPages || 1}
            value={page}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (
                Number.isInteger(n) &&
                n >= 1 &&
                n <= (document?.numPages || 1)
              )
                onPosition({ page: n });
            }}
          />
        </label>
        <span>of {document?.numPages || "…"}</span>
        <button
          type="button"
          disabled={!document || page >= document.numPages}
          onClick={() => onPosition({ page: page + 1 })}
        >
          Next page
        </button>
      </div>
      <form
        className="viewer-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <label>
          Find in PDF
          <input
            type="search"
            maxLength={200}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button disabled={!document || !search.trim()}>Search PDF</button>
        {searchStatus === "Searching…" && (
          <button
            type="button"
            onClick={() => {
              searchRun.current++;
              setSearchStatus("Search stopped.");
            }}
          >
            Stop search
          </button>
        )}
      </form>
      <p role="status">
        {searchStatus || (busy ? "Loading page…" : `Page ${page}`)}
      </p>
      {!!matches.length && (
        <div className="pdf-matches" aria-label="Matching PDF pages">
          {matches.map((n) => (
            <button key={n} onClick={() => onPosition({ page: n })}>
              Page {n}
            </button>
          ))}
        </div>
      )}
      <div className="pdf-canvas" aria-busy={busy}>
        <canvas ref={canvas} aria-label={`PDF page ${page}`} role="img" />
      </div>
      <details>
        <summary>Page text</summary>
        {pageText ? (
          <p className="resource-text">{pageText}</p>
        ) : (
          <p>
            Text is unavailable on this page. Image-only pages cannot be
            searched.
          </p>
        )}
      </details>
    </div>
  );
}
