import { ChangeEvent, FormEvent, MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  addComment,
  addHighlight,
  createAnnotationState,
  deleteComment,
  deleteHighlight,
  type AnnotationState,
} from "../annotations.ts";
import type { TutorContext, TutorCorePort } from "../core/tutor-core-port.ts";
import { moveToAdjacentPage, restoreSourceNavigation, sourceLocatorRects } from "../navigation.ts";
import { validatePdfFile } from "../pdf-file.ts";
import { captureSourceAnchor, type NormalizedRect, type SourceAnchor } from "../source-anchor.ts";
import { TutorTurnGate } from "../turn-session.ts";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface StudyWorkspaceAppProps {
  tutorCore: TutorCorePort;
}

interface ChatMessage {
  id: string;
  role: "learner" | "tutor";
  text: string;
  source?: SourceAnchor;
}

function useElementWidth(element: HTMLElement | null): number {
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return width;
}

function normalizedSelectionRects(range: Range, pageElement: HTMLElement): NormalizedRect[] {
  const pageRect = pageElement.getBoundingClientRect();
  if (pageRect.width === 0 || pageRect.height === 0) return [];
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => {
      const x = clamp((rect.left - pageRect.left) / pageRect.width);
      const y = clamp((rect.top - pageRect.top) / pageRect.height);
      const right = clamp((rect.right - pageRect.left) / pageRect.width);
      const bottom = clamp((rect.bottom - pageRect.top) / pageRect.height);
      return { x, y, width: right - x, height: bottom - y };
    })
    .filter((rect) => rect.width > 0 && rect.height > 0);
}

function sourceLabel(anchor: SourceAnchor): string {
  const precision = anchor.accuracy === "exact" ? "exact selection" : anchor.accuracy === "quote" ? "quote match" : "page context";
  return `Page ${anchor.page} · ${precision}`;
}

export function StudyWorkspaceApp({ tutorCore }: StudyWorkspaceAppProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileGeneration, setFileGeneration] = useState(0);
  const [documentId, setDocumentId] = useState("local:unloaded");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [readerElement, setReaderElement] = useState<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<SourceAnchor | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationState>(createAnnotationState);
  const [commentBody, setCommentBody] = useState("");
  const [commentScope, setCommentScope] = useState<"selection" | "page">("selection");
  const [linkComment, setLinkComment] = useState(false);
  const [context, setContext] = useState<TutorContext | null>(null);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activePane, setActivePane] = useState<"document" | "tutor">("document");
  const [turnPending, setTurnPending] = useState(false);
  const [focusedSource, setFocusedSource] = useState<SourceAnchor | null>(null);
  const idCounter = useRef(0);
  const intakeGeneration = useRef(0);
  const turnGate = useRef(new TutorTurnGate());
  const sourceTarget = useRef<HTMLSpanElement | null>(null);
  const readerWidth = useElementWidth(readerElement);
  const renderedWidth = Math.max(240, Math.min(900, Math.floor(readerWidth - 32)));

  const nextId = useCallback((prefix: string) => {
    idCounter.current += 1;
    return `${prefix}-${idCounter.current}`;
  }, []);

  useEffect(() => {
    let active = true;
    void tutorCore.getContext()
      .then((nextContext) => {
        if (active) setContext(nextContext);
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [tutorCore]);

  const focusSourceRegion = useCallback(() => {
    if (!focusedSource) return;
    requestAnimationFrame(() => {
      sourceTarget.current?.focus({ preventScroll: true });
      sourceTarget.current?.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    });
  }, [focusedSource]);

  useEffect(() => {
    focusSourceRegion();
  }, [focusSourceRegion, page]);

  const onDocumentLoad = useCallback((pdf: PDFDocumentProxy, generation: number) => {
    if (generation !== intakeGeneration.current) return;
    const loadedDocumentId = `pdf:${pdf.fingerprints[0] ?? "unknown"}`;
    setPageCount(pdf.numPages);
    setPage(1);
    setDocumentId(loadedDocumentId);
    setAnchor(captureSourceAnchor({ documentId: loadedDocumentId, page: 1 }));
    turnGate.current.replaceSession(loadedDocumentId);
    setTurnPending(false);
    setError(null);
  }, []);

  const selectPdf = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const selected = input.files?.[0] ?? null;
    intakeGeneration.current += 1;
    const generation = intakeGeneration.current;
    const loadingSession = selected ? `local:loading:${generation}` : "local:unloaded";
    turnGate.current.replaceSession(loadingSession);
    setTurnPending(false);
    setFile(null);
    setFileGeneration(0);
    setPage(1);
    setPageCount(0);
    setDocumentId(loadingSession);
    setAnnotations(createAnnotationState());
    setMessages([]);
    setAnchor(null);
    setFocusedSource(null);
    setError(null);
    if (!selected) return;

    const validation = await validatePdfFile(selected);
    if (generation !== intakeGeneration.current) return;
    if (!validation.ok) {
      input.value = "";
      setDocumentId("local:unloaded");
      turnGate.current.replaceSession("local:unloaded");
      setError(validation.message);
      return;
    }
    input.value = "";
    setFileGeneration(generation);
    setFile(selected);
  };

  const captureSelection = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!file || pageCount === 0) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const pageElement = event.currentTarget.querySelector<HTMLElement>(`[data-page-number="${page}"]`);
    if (!pageElement || !selection.anchorNode || !selection.focusNode) return;
    if (!pageElement.contains(selection.anchorNode) || !pageElement.contains(selection.focusNode)) return;
    const range = selection.getRangeAt(0);
    setAnchor(captureSourceAnchor({
      documentId,
      page,
      selectedText: selection.toString(),
      rects: normalizedSelectionRects(range, pageElement),
    }));
    setFocusedSource(null);
  }, [documentId, file, page, pageCount]);

  const addCurrentHighlight = () => {
    if (!anchor || anchor.kind !== "selection") return;
    setAnnotations((state) => addHighlight(state, {
      id: nextId("highlight"),
      anchor,
      createdAt: new Date().toISOString(),
    }));
  };

  const addCurrentComment = (event: FormEvent) => {
    event.preventDefault();
    const body = commentBody.trim();
    if (!file || pageCount === 0 || !body) return;
    const commentAnchor = commentScope === "selection" && anchor?.kind === "selection"
      ? anchor
      : captureSourceAnchor({ documentId, page });
    const linkedHighlight = linkComment
      ? annotations.highlights.findLast((highlight) =>
          highlight.anchor.documentId === commentAnchor.documentId
          && highlight.anchor.page === commentAnchor.page
          && highlight.anchor.quote === commentAnchor.quote)
      : undefined;
    setAnnotations((state) => addComment(state, {
      id: nextId("comment"),
      body,
      anchor: commentAnchor,
      ...(linkedHighlight ? { highlightId: linkedHighlight.id } : {}),
      createdAt: new Date().toISOString(),
    }));
    setCommentBody("");
    setLinkComment(false);
  };

  const sendQuestion = async (event: FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!file || pageCount === 0 || !text || turnGate.current.isPending()) return;
    const source = anchor ?? captureSourceAnchor({ documentId, page });
    try {
      const result = await turnGate.current.send(tutorCore, { question: text, source }, () => {
        setMessages((current) => [...current, { id: nextId("learner"), role: "learner", text, source }]);
        setQuestion((current) => current.trim() === text ? "" : current);
        setTurnPending(true);
      });
      if (result.status !== "accepted") return;
      const response = result.response;
      const responseTarget = restoreSourceNavigation(response.source, documentId, pageCount);
      if (!responseTarget) {
        setError("The tutor returned a source location outside the active PDF.");
      }
      setMessages((current) => [...current, {
        id: nextId("tutor"),
        role: "tutor",
        text: response.message,
        ...(responseTarget ? { source: responseTarget.anchor } : {}),
      }]);
      setContext(response.context);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setTurnPending(turnGate.current.isPending());
    }
  };

  const navigateTo = (source: SourceAnchor) => {
    const target = restoreSourceNavigation(source, documentId, pageCount);
    if (!target) {
      setError("This source location is not valid for the active PDF.");
      return;
    }
    setPage(target.page);
    setAnchor(target.anchor);
    setFocusedSource(target.anchor.accuracy === "exact" ? target.anchor : null);
    setActivePane("document");
    setError(null);
  };

  const moveDocumentPage = (delta: number) => {
    const target = moveToAdjacentPage({ current: page, total: pageCount }, delta, documentId);
    setPage(target.page);
    setAnchor(target.anchor);
    setFocusedSource(null);
  };

  const visibleHighlightRects = annotations.highlights
    .filter((highlight) => highlight.anchor.documentId === documentId && highlight.anchor.page === page)
    .flatMap((highlight) => (highlight.anchor.rects ?? []).map((rect, index) => ({
      key: `${highlight.id}-${index}`,
      rect,
    })));

  return (
    <main className="app-shell" data-active-pane={activePane}>
      <header className="app-header">
        <div>
          <p className="eyebrow">Isolated prototype · disposable state</p>
          <h1>PDF study workspace</h1>
        </div>
        <label className="file-button">
          <span>Open local PDF</span>
          <input
            data-testid="pdf-file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={selectPdf}
          />
        </label>
      </header>

      <nav className="mobile-tabs" aria-label="Workspace panels">
        <button aria-pressed={activePane === "document"} className={activePane === "document" ? "active" : ""} onClick={() => setActivePane("document")}>Document</button>
        <button aria-pressed={activePane === "tutor"} className={activePane === "tutor" ? "active" : ""} onClick={() => setActivePane("tutor")}>Tutor</button>
      </nav>

      {error ? <p className="error-banner" role="alert">{error}</p> : null}

      <div className="workspace-grid">
        <section className="workspace-pane document-pane" aria-label="PDF workspace">
          <div className="pane-heading">
            <div>
              <p className="eyebrow">Source workspace</p>
              <h2>{file?.name ?? "No PDF selected"}</h2>
            </div>
            <div className="page-controls" aria-label="PDF page navigation">
              <button data-testid="prev-page" disabled={pageCount === 0 || page === 1} onClick={() => moveDocumentPage(-1)}>Previous</button>
              <span data-testid="pdf-page-status" aria-live="polite">{pageCount ? `${page} / ${pageCount}` : "— / —"}</span>
              <button data-testid="next-page" disabled={pageCount === 0 || page === pageCount} onClick={() => moveDocumentPage(1)}>Next</button>
            </div>
          </div>

          <div className="source-strip" aria-live="polite">
            {anchor ? (
              <span className="source-chip" data-testid="selection-chip" title={anchor.quote}>
                {sourceLabel(anchor)}{anchor.quote ? ` · “${anchor.quote.slice(0, 68)}${anchor.quote.length > 68 ? "…" : ""}”` : ""}
              </span>
            ) : <span className="source-chip muted">Select text after opening a PDF to capture context.</span>}
            <button data-testid="add-highlight" disabled={anchor?.kind !== "selection"} onClick={addCurrentHighlight}>Highlight selection</button>
          </div>

          {focusedSource ? (
            <p className="source-jump-status" role="status" data-testid="source-jump-status">
              Focused source location on page {focusedSource.page}.
            </p>
          ) : null}

          <div className="reader" ref={setReaderElement} onMouseUp={captureSelection}>
            {file ? (
              <Document
                key={fileGeneration}
                file={file}
                suspense={false}
                loading={<p className="reader-message" role="status">Loading PDF…</p>}
                error={<p className="reader-message" role="alert">This PDF could not be rendered.</p>}
                onLoadSuccess={(pdf) => onDocumentLoad(pdf, fileGeneration)}
                onLoadError={(reason) => setError(`PDF load failed: ${reason.message}`)}
              >
                <div className="pdf-page-shell">
                  <Page
                    pageNumber={page}
                    width={renderedWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer
                    loading={<p className="reader-message" role="status">Rendering page…</p>}
                    onRenderSuccess={focusSourceRegion}
                  />
                  <div className="saved-highlight-layer" aria-hidden="true">
                    {visibleHighlightRects.map(({ key, rect }) => (
                      <span
                        key={key}
                        style={{
                          left: `${rect.x * 100}%`,
                          top: `${rect.y * 100}%`,
                          width: `${rect.width * 100}%`,
                          height: `${rect.height * 100}%`,
                        }}
                      />
                    ))}
                  </div>
                  <div className="source-focus-layer">
                    {sourceLocatorRects(focusedSource).map((rect, index) => (
                      <span
                        key={`source-focus-${index}`}
                        ref={index === 0 ? sourceTarget : undefined}
                        data-testid={index === 0 ? "source-jump-target" : undefined}
                        tabIndex={index === 0 ? -1 : undefined}
                        role={index === 0 ? "region" : undefined}
                        aria-label={index === 0 ? `Focused source location on page ${page}` : undefined}
                        aria-hidden={index === 0 ? undefined : true}
                        style={{
                          left: `${rect.x * 100}%`,
                          top: `${rect.y * 100}%`,
                          width: `${rect.width * 100}%`,
                          height: `${rect.height * 100}%`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              </Document>
            ) : (
              <div className="empty-reader">
                <p className="eyebrow">Local-only PDF spike</p>
                <h3>Choose a PDF from this device</h3>
                <p>The file is passed directly to PDF.js in this browser session. Prototype annotations are not persisted.</p>
              </div>
            )}
          </div>

          <div className="annotation-workbench">
            <form className="comment-form" onSubmit={addCurrentComment}>
              <div className="section-title">
                <div>
                  <p className="eyebrow">Independent annotation</p>
                  <h3>Add a comment</h3>
                </div>
                <select data-testid="comment-scope" aria-label="Comment anchor" value={commentScope} onChange={(event) => setCommentScope(event.target.value as "selection" | "page")}>
                  <option value="selection" disabled={anchor?.kind !== "selection"}>Current selection</option>
                  <option value="page">Current page</option>
                </select>
              </div>
              <textarea data-testid="comment-input" aria-label="Comment text" value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Write a note about this source context" />
              <label className="check-row">
                <input data-testid="link-highlight" type="checkbox" checked={linkComment} onChange={(event) => setLinkComment(event.target.checked)} />
                Reference the latest matching highlight when available
              </label>
              <button data-testid="add-comment" type="submit" disabled={pageCount === 0 || !commentBody.trim() || (commentScope === "selection" && anchor?.kind !== "selection")}>Add comment</button>
            </form>

            <div className="annotation-lists">
              <section aria-labelledby="highlight-heading">
                <div className="section-title"><h3 id="highlight-heading">Highlights</h3><span>{annotations.highlights.length}</span></div>
                <ul data-testid="highlight-list">
                  {annotations.highlights.map((highlight) => (
                    <li key={highlight.id}>
                      <button className="annotation-link" onClick={() => navigateTo(highlight.anchor)}>{sourceLabel(highlight.anchor)} · {highlight.anchor.quote}</button>
                      <button className="delete-button" aria-label={`Delete highlight on page ${highlight.anchor.page}`} onClick={() => setAnnotations((state) => deleteHighlight(state, highlight.id))}>Delete</button>
                    </li>
                  ))}
                  {annotations.highlights.length === 0 ? <li className="empty-row">No highlights yet.</li> : null}
                </ul>
              </section>
              <section aria-labelledby="comment-heading">
                <div className="section-title"><h3 id="comment-heading">Comments</h3><span>{annotations.comments.length}</span></div>
                <ul data-testid="comment-list">
                  {annotations.comments.map((comment) => (
                    <li key={comment.id}>
                      <button className="annotation-link" onClick={() => navigateTo(comment.anchor)}>{comment.body}<small>{sourceLabel(comment.anchor)}{comment.highlightId ? " · references highlight" : ""}</small></button>
                      <button className="delete-button" aria-label={`Delete comment on page ${comment.anchor.page}`} onClick={() => setAnnotations((state) => deleteComment(state, comment.id))}>Delete</button>
                    </li>
                  ))}
                  {annotations.comments.length === 0 ? <li className="empty-row">No comments yet.</li> : null}
                </ul>
              </section>
            </div>
          </div>
        </section>

        <aside className="workspace-pane tutor-pane" aria-label="Tutor conversation">
          <div className="pane-heading tutor-heading">
            <div>
              <p className="eyebrow">Application port {tutorCore.version}</p>
              <h2>Tutor conversation</h2>
            </div>
            <span className="mock-badge">Mock adapter · no Hermes transport</span>
          </div>

          {context ? (
            <section className="context-card" aria-label="Mock tutor context">
              <div><span>Concept</span><strong>{context.concept.title}</strong></div>
              <div><span>Action</span><strong>{context.action}</strong></div>
              <div><span>Reasons</span><strong>{context.reasonCodes.join(" · ")}</strong></div>
              <div><span>Evidence</span><strong>{context.evidenceEventIds.join(" · ")}</strong></div>
            </section>
          ) : <p role="status">Loading mock context…</p>}

          <div className="conversation" aria-live="polite">
            {messages.length === 0 ? (
              <div className="welcome-message">
                <p className="eyebrow">Fixture interaction</p>
                <h3>Ask about the current page or selection.</h3>
                <p>The response is deterministic fixture text. It does not call Hermes, append ledger events, rebuild projections, or change concept state.</p>
              </div>
            ) : messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <span>{message.role === "tutor" ? "Mock tutor" : "You"}</span>
                <p>{message.text}</p>
                {message.source ? <button className="source-chip" onClick={() => navigateTo(message.source!)}>{sourceLabel(message.source)}</button> : null}
              </article>
            ))}
          </div>

          <form className="chat-form" onSubmit={sendQuestion}>
            {anchor ? <span className="source-chip">Using {sourceLabel(anchor)}</span> : null}
            <label htmlFor="tutor-question">Question for the mock tutor</label>
            <textarea id="tutor-question" data-testid="tutor-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about the current source context" />
            <button data-testid="send-question" type="submit" disabled={pageCount === 0 || !question.trim() || turnPending}>{turnPending ? "Waiting for MockTutorCore…" : "Send to MockTutorCore"}</button>
          </form>
        </aside>
      </div>
    </main>
  );
}
