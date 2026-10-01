"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  MessageSquare,
  ZoomIn,
  ZoomOut,
  PanelRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { QuoteNavigatorBar } from "@/components/viewer/QuoteNavigatorBar";
import { QuoteSidePanel } from "@/components/viewer/QuoteSidePanel";
import { FallbackExcerptDialog } from "@/components/viewer/FallbackExcerptDialog";
import { PdfViewer } from "@/components/viewer/PdfViewer";
import { DocxViewer } from "@/components/viewer/DocxViewer";
import { VerifiedQuoteItem } from "@/lib/chat/streamParser";
import { ViewerDocument, ViewerPage, ActiveQuoteTarget } from "@/lib/viewer/types";
import { getPassageExcerpt, PassageExcerpt } from "@/lib/viewer/fallbackExcerpt";
import { verifyQuote } from "@/lib/quotes/verify";

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.0;
const ZOOM_STEP = 0.15;

interface DocumentViewerClientProps {
  documentId: string;
  initialQuoteN?: number;
  initialOccurrence?: number;
  initialMessageId?: string;
}

export function DocumentViewerClient({
  documentId,
  initialQuoteN,
  initialOccurrence,
  initialMessageId,
}: DocumentViewerClientProps) {
  const [doc, setDoc] = useState<ViewerDocument | null>(null);
  const [docPages, setDocPages] = useState<ViewerPage[]>([]);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [docError, setDocError] = useState<string | null>(null);

  const [activeQuotes, setActiveQuotes] = useState<VerifiedQuoteItem[]>([]);
  const [messageContent, setMessageContent] = useState<string | undefined>();
  const [activeTarget, setActiveTarget] = useState<ActiveQuoteTarget | null>(null);
  const [visiblePage, setVisiblePage] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [fallbackExcerpt, setFallbackExcerpt] = useState<PassageExcerpt | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | undefined>();

  const { toast: showToast } = useToast();

  // Load document metadata + pages
  useEffect(() => {
    let cancelled = false;

    async function fetchDoc() {
      setLoadingDoc(true);
      setDocError(null);

      try {
        const res = await fetch(`/api/documents/${documentId}`);
        if (!res.ok) throw new Error(`Document not found (${res.status})`);
        const data = await res.json();
        if (!cancelled) {
          setDoc(data.document);
          setDocPages(data.pages || []);
        }
      } catch (err: any) {
        if (!cancelled) setDocError(err?.message || "Failed to load document");
      } finally {
        if (!cancelled) setLoadingDoc(false);
      }
    }

    fetchDoc();
    return () => { cancelled = true; };
  }, [documentId]);

  // Load quotes from the chat message if messageId is provided
  useEffect(() => {
    if (!initialMessageId || !documentId) return;

    let cancelled = false;

    async function fetchMessageQuotes() {
      try {
        // We fetch all conversations for this document and find the message
        const res = await fetch(`/api/conversations?documentId=${documentId}`);
        if (!res.ok) return;
        const data = await res.json();
        const convs: any[] = data.conversations || [];

        for (const conv of convs) {
          const msgRes = await fetch(`/api/conversations/${conv.id}`);
          if (!msgRes.ok) continue;
          const msgData = await msgRes.json();
          const msgs = msgData.messages || [];
          const targetMsg = msgs.find((m: any) => m.id === initialMessageId);
          if (targetMsg) {
            if (!cancelled) {
              setActiveQuotes(targetMsg.quotes || []);
              setMessageContent(targetMsg.content);
            }
            return;
          }
        }
      } catch {
        // non-critical
      }
    }

    fetchMessageQuotes();
    return () => { cancelled = true; };
  }, [initialMessageId, documentId]);

  // Activate the initial quoted target from URL params
  const hasAutoActivated = useRef(false);

  useEffect(() => {
    if (hasAutoActivated.current) return;
    if (loadingDoc || !doc || !doc.canonicalText) return;

    if (activeQuotes.length > 0 && typeof initialQuoteN === "number") {
      const q = activeQuotes.find((q) => q.n === initialQuoteN);
      if (q && q.status === "verified" && q.occurrences.length > 0) {
        hasAutoActivated.current = true;
        activateQuote(q, initialOccurrence ?? 0);
      }
    }
  }, [loadingDoc, doc, activeQuotes, initialQuoteN, initialOccurrence]);

  // Keyboard handler: Escape clears highlight
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setActiveTarget(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Activate a quote from side panel or URL
  const activateQuote = useCallback(
    (quote: VerifiedQuoteItem, occurrenceIndex: number = 0) => {
      if (!doc) return;

      if (quote.status !== "verified" || quote.occurrences.length === 0) {
        // Show fallback if unverified
        const canonicalText = doc.canonicalText || "";
        const excerpt = getPassageExcerpt(canonicalText, 0, 0, 400);
        setFallbackExcerpt(excerpt);
        setFallbackReason(
          `This quote couldn't be code-verified: ${quote.reason || "not found in document"}`
        );
        setFallbackOpen(true);
        return;
      }

      const safeIdx = Math.max(
        0,
        Math.min(occurrenceIndex, quote.occurrences.length - 1)
      );

      setActiveTarget({
        n: quote.n,
        quote: quote.quote,
        occurrenceIndex: safeIdx,
        occurrences: quote.occurrences,
        pageStart: quote.pageStart,
        pageEnd: quote.pageEnd,
        messageId: initialMessageId,
        ambiguous: quote.ambiguous,
      });
    },
    [doc, initialMessageId]
  );

  const handleSelectQuoteFromPanel = useCallback(
    (quote: VerifiedQuoteItem, occurrenceIndex: number = 0) => {
      activateQuote(quote, occurrenceIndex);
    },
    [activateQuote]
  );

  const handlePrevOccurrence = useCallback(() => {
    if (!activeTarget) return;
    const n = activeTarget.occurrences.length;
    const prev = (activeTarget.occurrenceIndex - 1 + n) % n;
    setActiveTarget((t) => (t ? { ...t, occurrenceIndex: prev } : null));
  }, [activeTarget]);

  const handleNextOccurrence = useCallback(() => {
    if (!activeTarget) return;
    const n = activeTarget.occurrences.length;
    const next = (activeTarget.occurrenceIndex + 1) % n;
    setActiveTarget((t) => (t ? { ...t, occurrenceIndex: next } : null));
  }, [activeTarget]);

  const handleVisualMappingFailed = useCallback(
    (reason: string) => {
      if (!activeTarget || !doc?.canonicalText) return;
      const occ = activeTarget.occurrences[activeTarget.occurrenceIndex];
      if (!occ) return;

      const excerpt = getPassageExcerpt(doc.canonicalText, occ.start, occ.end, 600);
      setFallbackExcerpt(excerpt);
      setFallbackReason(`Couldn't locate this visually — showing the passage text`);
      setFallbackOpen(true);
      showToast({
        title: "Couldn't locate this visually",
        description: "Showing the passage text instead.",
        type: "info",
      });
    },
    [activeTarget, doc, showToast]
  );

  const handleOpenFallback = useCallback(() => {
    if (!activeTarget || !doc?.canonicalText) return;
    const occ = activeTarget.occurrences[activeTarget.occurrenceIndex];
    if (!occ) return;
    const excerpt = getPassageExcerpt(doc.canonicalText, occ.start, occ.end, 600);
    setFallbackExcerpt(excerpt);
    setFallbackReason(undefined);
    setFallbackOpen(true);
  }, [activeTarget, doc]);

  const isPdf = doc?.mime === "application/pdf";
  const isDocx =
    doc?.mime ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  const documentTitle = doc?.name || "Document";
  const pageCount = doc?.pageCount || docPages.length || 0;

  return (
    <div className="flex flex-col h-screen bg-[#F7F5F0] overflow-hidden">
      {/* Top Bar */}
      <header className="h-14 bg-[#FCFBF8] border-b border-[#E7E2D9] flex items-center px-4 gap-3 flex-shrink-0 z-10">
        <Link href="/">
          <Button variant="ghost" size="sm" className="h-8 px-2.5 gap-1.5 text-xs">
            <ArrowLeft className="w-4 h-4" />
            Library
          </Button>
        </Link>

        <div className="w-px h-5 bg-[#E7E2D9] flex-shrink-0" />

        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold text-[#171717] truncate">
            {documentTitle}
          </h1>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#77736C]">
              {isPdf ? "PDF" : isDocx ? "DOCX" : doc?.mime || "Document"}
            </span>
            {pageCount > 0 && (
              <span className="text-[11px] text-[#77736C]">
                · {pageCount} {pageCount === 1 ? "page" : "pages"}
              </span>
            )}
            {pageCount > 0 && (
              <span className="text-[11px] text-[#77736C] bg-[#F7F5F0] border border-[#E7E2D9] px-1.5 py-0.2 rounded-[4px]">
                Page {visiblePage} of {pageCount}
              </span>
            )}
          </div>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 bg-[#F7F5F0] border border-[#E7E2D9] rounded-[8px] p-0.5">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(ZOOM_MIN, s - ZOOM_STEP))}
            disabled={scale <= ZOOM_MIN}
            title="Zoom out"
            className="p-1.5 text-[#77736C] hover:text-[#171717] disabled:opacity-30 rounded-[6px] transition-colors"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <span className="text-xs font-medium text-[#171717] px-2 min-w-[46px] text-center">
            {Math.round(scale * 100)}%
          </span>

          <button
            type="button"
            onClick={() => setScale((s) => Math.min(ZOOM_MAX, s + ZOOM_STEP))}
            disabled={scale >= ZOOM_MAX}
            title="Zoom in"
            className="p-1.5 text-[#77736C] hover:text-[#171717] disabled:opacity-30 rounded-[6px] transition-colors"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        <Link href={`/documents/${documentId}/chat`}>
          <Button variant="primary" size="sm" className="h-8 gap-1.5 text-xs">
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Chat</span>
          </Button>
        </Link>

        {/* Side Panel Toggle */}
        <button
          type="button"
          onClick={() => setSidePanelOpen((o) => !o)}
          title={sidePanelOpen ? "Collapse citation panel" : "Open citation panel"}
          className="p-1.5 text-[#77736C] hover:text-[#171717] hover:bg-[#F7F5F0] rounded-[8px] transition-colors relative"
        >
          <PanelRight className="w-4 h-4" />
          {activeQuotes.length > 0 && (
            <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-[#F97316]" />
          )}
        </button>
      </header>

      {/* Quote Navigator Bar */}
      {activeTarget && (
        <div className="px-4 pt-3 pb-1 flex-shrink-0 z-10">
          <QuoteNavigatorBar
            target={activeTarget}
            activePageNumber={visiblePage}
            onPrevOccurrence={handlePrevOccurrence}
            onNextOccurrence={handleNextOccurrence}
            onClose={() => setActiveTarget(null)}
            onOpenFallback={handleOpenFallback}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Document Viewer */}
        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
          {loadingDoc && (
            <div className="flex-1 flex items-center justify-center text-[#77736C] text-sm">
              Loading document…
            </div>
          )}

          {docError && !loadingDoc && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
              <p className="text-sm font-semibold text-[#171717]">
                Failed to load document
              </p>
              <p className="text-xs text-[#77736C] max-w-sm">{docError}</p>
              <Link href="/">
                <Button variant="secondary" size="sm">
                  Back to Library
                </Button>
              </Link>
            </div>
          )}

          {!loadingDoc && !docError && doc && (
            <>
              {isPdf && (
                <PdfViewer
                  documentId={documentId}
                  pages={docPages}
                  activeTarget={activeTarget}
                  scale={scale}
                  onVisualMappingFailed={handleVisualMappingFailed}
                  onVisiblePageChange={setVisiblePage}
                />
              )}

              {isDocx && doc.htmlContent && (
                <div className="flex-1 overflow-y-auto">
                  <DocxViewer
                    htmlContent={doc.htmlContent}
                    activeTarget={activeTarget}
                    onVisualMappingFailed={handleVisualMappingFailed}
                    scale={scale}
                  />
                </div>
              )}

              {!isPdf && !isDocx && (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
                  <p className="text-sm font-semibold text-[#171717]">
                    Unsupported document type
                  </p>
                  <p className="text-xs text-[#77736C]">
                    Only PDF and DOCX files can be rendered in the viewer.
                  </p>
                </div>
              )}
            </>
          )}
        </main>

        {/* Side Panel */}
        <QuoteSidePanel
          documentId={documentId}
          quotes={activeQuotes}
          messageContent={messageContent}
          messageId={initialMessageId}
          activeTarget={activeTarget}
          onSelectQuote={handleSelectQuoteFromPanel}
          isOpen={sidePanelOpen}
          onToggle={() => setSidePanelOpen((o) => !o)}
        />
      </div>

      {/* Fallback Excerpt Dialog */}
      {fallbackOpen && fallbackExcerpt && (
        <FallbackExcerptDialog
          isOpen={fallbackOpen}
          onClose={() => setFallbackOpen(false)}
          excerpt={fallbackExcerpt}
          pageNumber={activeTarget ? (activeTarget.pageStart ?? undefined) : undefined}
          quoteIndex={activeTarget?.n}
          reason={fallbackReason}
        />
      )}


    </div>
  );
}
