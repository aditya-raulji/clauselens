"use client";

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { ViewerPage, ActiveQuoteTarget, HighlightRect } from "@/lib/viewer/types";
import {
  buildPageTextWithOffsets,
  findOverlappingItemSlices,
  mergeBoundingRects,
} from "@/lib/viewer/pdfOffsets";
import { verifyQuote } from "@/lib/quotes/verify";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Loader2 } from "lucide-react";

interface PdfViewerProps {
  documentId: string;
  pages: ViewerPage[];
  activeTarget: ActiveQuoteTarget | null;
  scale: number;
  onVisualMappingFailed: (reason: string) => void;
  onVisiblePageChange?: (pageNumber: number) => void;
}

interface PageRenderState {
  rendered: boolean;
  rendering: boolean;
  rects: HighlightRect[];
  nonSelectedRects: HighlightRect[];
  error?: string;
  width: number;
  height: number;
}

export function PdfViewer({
  documentId,
  pages,
  activeTarget,
  scale,
  onVisualMappingFailed,
  onVisiblePageChange,
}: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [docError, setDocError] = useState<string | null>(null);

  // Track rendered state for each page
  const [pageStates, setPageStates] = useState<Record<number, PageRenderState>>({});
  // Track which pages are near the viewport
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1, 2]));

  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const textLayerRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const textContentCache = useRef<Map<number, any>>(new Map());
  const hasScrolledForCurrentTarget = useRef<string | null>(null);

  // 1. Load PDF Document via pdfjs-dist
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setLoadingDoc(true);
      setDocError(null);

      try {
        const pdfjs = await import("pdfjs-dist");
        if (typeof window !== "undefined") {
          pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        }

        const url = `/api/documents/${documentId}/file`;
        const loadingTask = pdfjs.getDocument({
          url,
          useSystemFonts: true,
          disableFontFace: false,
        });

        const doc = await loadingTask.promise;
        if (!cancelled) {
          setPdfDoc(doc);
          setLoadingDoc(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setDocError(err?.message || "Failed to load PDF document");
          setLoadingDoc(false);
        }
      }
    }

    loadPdf();
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const totalPages = pdfDoc ? pdfDoc.numPages : pages.length || 1;

  // 2. IntersectionObserver for virtualized page rendering
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          entries.forEach((entry) => {
            const pageNum = Number(entry.target.getAttribute("data-page-number"));
            if (pageNum) {
              if (entry.isIntersecting) {
                // Add this page and adjacent buffer pages
                next.add(pageNum);
                if (pageNum > 1) next.add(pageNum - 1);
                if (pageNum < totalPages) next.add(pageNum + 1);
              }
            }
          });
          return next;
        });

        // Determine currently active visible page for header indicator
        const visibleEntry = entries.find((e) => e.isIntersecting);
        if (visibleEntry) {
          const pageNum = Number(visibleEntry.target.getAttribute("data-page-number"));
          if (pageNum && onVisiblePageChange) {
            onVisiblePageChange(pageNum);
          }
        }
      },
      {
        root: containerRef.current,
        rootMargin: "400px 0px 400px 0px",
        threshold: 0.1,
      }
    );

    pageRefs.current.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [totalPages, onVisiblePageChange]);

  // 3. Render a single page (canvas + textLayer) and calculate highlight rects
  const renderPage = useCallback(
    async (pageNumber: number) => {
      if (!pdfDoc) return;

      const pageContainer = pageRefs.current.get(pageNumber);
      const canvas = canvasRefs.current.get(pageNumber);
      const textLayerDiv = textLayerRefs.current.get(pageNumber);

      if (!pageContainer || !canvas || !textLayerDiv) return;

      try {
        setPageStates((prev) => ({
          ...prev,
          [pageNumber]: {
            rendered: prev[pageNumber]?.rendered || false,
            rendering: true,
            rects: prev[pageNumber]?.rects || [],
            nonSelectedRects: prev[pageNumber]?.nonSelectedRects || [],
            width: prev[pageNumber]?.width || 612 * scale,
            height: prev[pageNumber]?.height || 792 * scale,
          },
        }));

        const pdfjs = await import("pdfjs-dist");
        const page = await pdfDoc.getPage(pageNumber);
        const viewport = page.getViewport({ scale });

        // A. Setup Canvas
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = viewport.width * pixelRatio;
        canvas.height = viewport.height * pixelRatio;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
          await page.render({ canvasContext: ctx, viewport }).promise;
        }

        // B. Setup TextLayer
        textLayerDiv.innerHTML = "";
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;

        let textContent = textContentCache.current.get(pageNumber);
        if (!textContent) {
          textContent = await page.getTextContent();
          textContentCache.current.set(pageNumber, textContent);
        }

        const textLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });

        await textLayer.render();

        setPageStates((prev) => ({
          ...prev,
          [pageNumber]: {
            rendered: true,
            rendering: false,
            rects: prev[pageNumber]?.rects || [],
            nonSelectedRects: prev[pageNumber]?.nonSelectedRects || [],
            width: viewport.width,
            height: viewport.height,
          },
        }));
      } catch (err: any) {
        setPageStates((prev) => ({
          ...prev,
          [pageNumber]: {
            rendered: false,
            rendering: false,
            rects: [],
            nonSelectedRects: [],
            error: err?.message,
            width: 612 * scale,
            height: 792 * scale,
          },
        }));
      }
    },
    [pdfDoc, scale]
  );

  // Trigger render for newly visible pages
  useEffect(() => {
    if (!pdfDoc) return;
    visiblePages.forEach((pageNum) => {
      const state = pageStates[pageNum];
      if (!state?.rendered && !state?.rendering) {
        renderPage(pageNum);
      }
    });
  }, [pdfDoc, visiblePages, pageStates, renderPage]);

  // 4. Calculate DOM Range Highlights across rendered textLayers
  const computeHighlightsForPage = useCallback(
    (
      pageNumber: number,
      pageMeta: ViewerPage | undefined,
      textContent: any,
      target: ActiveQuoteTarget
    ) => {
      const pageContainer = pageRefs.current.get(pageNumber);
      const textLayerDiv = textLayerRefs.current.get(pageNumber);
      if (!pageContainer || !textLayerDiv || !textContent) {
        return { selectedRects: [], nonSelectedRects: [] };
      }

      // Compute item offsets inside pageText
      const { text: clientPageText, items: itemOffsets } =
        buildPageTextWithOffsets(textContent.items as any[]);

      const containerRect = pageContainer.getBoundingClientRect();
      const textSpans = Array.from(textLayerDiv.querySelectorAll("span"));

      const computeRectsForOccurrence = (startOffset: number, endOffset: number) => {
        let localStart = 0;
        let localEnd = 0;

        if (pageMeta) {
          // Canonical coordinates mapping
          if (endOffset <= pageMeta.startOffset || startOffset >= pageMeta.endOffset) {
            return [];
          }
          localStart = Math.max(0, startOffset - pageMeta.startOffset);
          localEnd = Math.min(clientPageText.length, endOffset - pageMeta.startOffset);
        } else {
          // Fallback: locate normalized quote in clientPageText
          const vRes = verifyQuote(target.quote, clientPageText);
          if (vRes.status !== "verified" || vRes.occurrences.length === 0) {
            return [];
          }
          localStart = vRes.occurrences[0].start;
          localEnd = vRes.occurrences[0].end;
        }

        if (localStart >= localEnd) return [];

        const slices = findOverlappingItemSlices(itemOffsets, localStart, localEnd);
        const rects: HighlightRect[] = [];

        slices.forEach((slice) => {
          const span = textSpans[slice.itemIndex];
          if (!span || !span.firstChild) return;

          const textNode = span.firstChild;
          const nodeLen = textNode.textContent?.length || 0;
          const safeStart = Math.min(slice.sliceStart, nodeLen);
          const safeEnd = Math.min(slice.sliceEnd, nodeLen);

          if (safeStart < safeEnd) {
            try {
              const range = document.createRange();
              range.setStart(textNode, safeStart);
              range.setEnd(textNode, safeEnd);

              const clientRects = Array.from(range.getClientRects());
              clientRects.forEach((r) => {
                if (r.width > 0 && r.height > 0) {
                  rects.push({
                    left: r.left - containerRect.left,
                    top: r.top - containerRect.top,
                    width: r.width,
                    height: r.height,
                    pageNumber,
                  });
                }
              });
            } catch {
              // DOM range failed on this span
            }
          }
        });

        return mergeBoundingRects(rects);
      };

      const selectedOcc = target.occurrences[target.occurrenceIndex];
      const selectedRects = selectedOcc
        ? computeRectsForOccurrence(selectedOcc.start, selectedOcc.end)
        : [];

      // Non-selected occurrences
      let nonSelectedRects: HighlightRect[] = [];
      target.occurrences.forEach((occ, idx) => {
        if (idx !== target.occurrenceIndex) {
          const occRects = computeRectsForOccurrence(occ.start, occ.end);
          nonSelectedRects = nonSelectedRects.concat(occRects);
        }
      });

      return { selectedRects, nonSelectedRects };
    },
    []
  );

  // 5. Update highlights whenever activeTarget, pages, or rendered state changes
  useEffect(() => {
    if (!activeTarget) {
      setPageStates((prev) => {
        const next: Record<number, PageRenderState> = {};
        for (const [k, v] of Object.entries(prev)) {
          next[Number(k)] = { ...v, rects: [], nonSelectedRects: [] };
        }
        return next;
      });
      hasScrolledForCurrentTarget.current = null;
      return;
    }

    const currentKey = `${activeTarget.n}-${activeTarget.occurrenceIndex}-${scale}`;
    let totalFoundRects = 0;

    visiblePages.forEach((pageNum) => {
      const pageMeta = pages.find((p) => p.pageNumber === pageNum);
      const textContent = textContentCache.current.get(pageNum);

      if (textContent) {
        const { selectedRects, nonSelectedRects } = computeHighlightsForPage(
          pageNum,
          pageMeta,
          textContent,
          activeTarget
        );

        totalFoundRects += selectedRects.length;

        setPageStates((prev) => {
          const curr = prev[pageNum];
          if (!curr) return prev;
          return {
            ...prev,
            [pageNum]: {
              ...curr,
              rects: selectedRects,
              nonSelectedRects,
            },
          };
        });
      }
    });

    // Auto-scroll to first highlight of active occurrence
    if (
      totalFoundRects > 0 &&
      hasScrolledForCurrentTarget.current !== currentKey
    ) {
      hasScrolledForCurrentTarget.current = currentKey;

      // Find first page with highlight rects
      const pageWithRect = Array.from(visiblePages).find((p) => {
        return (pageStates[p]?.rects || []).length > 0;
      });

      if (pageWithRect) {
        const el = pageRefs.current.get(pageWithRect);
        const firstRect = pageStates[pageWithRect]?.rects[0];
        if (el && firstRect) {
          const targetY = el.offsetTop + firstRect.top - 120;
          containerRef.current?.scrollTo({
            top: targetY,
            behavior: "smooth",
          });
        }
      }
    }
  }, [activeTarget, pages, visiblePages, pageStates, scale, computeHighlightsForPage]);

  // Ensure target page is mounted in visiblePages
  useEffect(() => {
    if (activeTarget && activeTarget.pageStart) {
      setVisiblePages((prev) => {
        const next = new Set(prev);
        next.add(activeTarget.pageStart!);
        if (activeTarget.pageEnd) next.add(activeTarget.pageEnd);
        return next;
      });
    }
  }, [activeTarget]);

  if (loadingDoc) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-[#77736C]">
        <Loader2 className="w-8 h-8 animate-spin text-[#F97316] mb-3" />
        <p className="text-sm font-medium text-[#171717]">
          Loading document pages…
        </p>
        <p className="text-xs text-[#77736C] mt-1">
          Preparing high-precision canvas and text layout
        </p>
      </div>
    );
  }

  if (docError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
        <div className="w-12 h-12 rounded-[12px] bg-[#B7791F]/10 text-[#B7791F] flex items-center justify-center mb-3">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h3 className="text-sm font-semibold text-[#171717]">
          Failed to load document
        </h3>
        <p className="text-xs text-[#77736C] max-w-sm mt-1 mb-4">
          {docError}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto overflow-x-auto p-4 sm:p-8 flex flex-col items-center gap-6 bg-[#F7F5F0]"
    >
      {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
        const state = pageStates[pageNum];
        const isVisible = visiblePages.has(pageNum);
        const pageWidth = state?.width || 612 * scale;
        const pageHeight = state?.height || 792 * scale;

        return (
          <div
            key={`page-${pageNum}`}
            data-page-number={pageNum}
            ref={(el) => {
              if (el) pageRefs.current.set(pageNum, el);
              else pageRefs.current.delete(pageNum);
            }}
            style={{ width: pageWidth, height: pageHeight }}
            className="relative bg-[#FCFBF8] border border-[#E7E2D9] rounded-[8px] shadow-[0_4px_20px_rgba(0,0,0,0.04)] overflow-hidden flex-shrink-0 transition-all select-text"
          >
            {/* Canvas layer */}
            <canvas
              ref={(el) => {
                if (el) canvasRefs.current.set(pageNum, el);
                else canvasRefs.current.delete(pageNum);
              }}
              className="absolute inset-0 block"
            />

            {/* Text layer for DOM text selection and range measurement */}
            <div
              ref={(el) => {
                if (el) textLayerRefs.current.set(pageNum, el);
                else textLayerRefs.current.delete(pageNum);
              }}
              className="textLayer absolute inset-0 select-text"
              style={{
                lineHeight: 1,
                userSelect: "text",
              }}
            />

            {/* Highlight overlay layer */}
            <div className="absolute inset-0 pointer-events-none z-10">
              {/* Non-selected occurrences of same quote */}
              {(state?.nonSelectedRects || []).map((r, idx) => (
                <div
                  key={`non-sel-rect-${pageNum}-${idx}`}
                  style={{
                    left: r.left,
                    top: r.top,
                    width: r.width,
                    height: r.height,
                  }}
                  className="absolute pointer-events-none bg-[#F97316]/20 border border-[#F97316]/50 rounded-[2px]"
                />
              ))}

              {/* Selected occurrence */}
              {(state?.rects || []).map((r, idx) => (
                <div
                  key={`sel-rect-${pageNum}-${idx}`}
                  style={{
                    left: r.left,
                    top: r.top,
                    width: r.width,
                    height: r.height,
                  }}
                  className="absolute pointer-events-none bg-[#F97316]/35 border-2 border-[#F97316] shadow-[0_0_0_1px_rgba(249,115,22,0.2)] rounded-[2px] transition-all"
                />
              ))}
            </div>

            {/* Skeleton loader when page is not yet rendered */}
            {(!isVisible || !state?.rendered) && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#FCFBF8] p-8 gap-4">
                <div className="w-full h-full flex flex-col justify-between py-6">
                  <Skeleton className="w-1/3 h-4" />
                  <div className="space-y-3">
                    <Skeleton className="w-full h-3" />
                    <Skeleton className="w-5/6 h-3" />
                    <Skeleton className="w-full h-3" />
                    <Skeleton className="w-4/5 h-3" />
                  </div>
                  <div className="space-y-3">
                    <Skeleton className="w-full h-3" />
                    <Skeleton className="w-3/4 h-3" />
                  </div>
                  <Skeleton className="w-16 h-3 self-center" />
                </div>
                <span className="absolute bottom-3 right-4 text-[10px] text-[#77736C]">
                  Page {pageNum} of {totalPages}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
