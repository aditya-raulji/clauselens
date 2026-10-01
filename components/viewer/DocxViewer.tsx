"use client";

import React, { useEffect, useRef, useMemo } from "react";
import { BlockOffset, ActiveQuoteTarget } from "@/lib/viewer/types";
import {
  parseBlockOffsets,
  cleanUpMarks,
  highlightDocxRange,
} from "@/lib/viewer/docxHighlight";

interface DocxViewerProps {
  htmlContent: string;
  activeTarget: ActiveQuoteTarget | null;
  onVisualMappingFailed: (reason: string) => void;
  scale?: number;
}

export function DocxViewer({
  htmlContent,
  activeTarget,
  onVisualMappingFailed,
  scale = 1.0,
}: DocxViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Extract block offsets from HTML
  const blockOffsets = useMemo<BlockOffset[]>(() => {
    return parseBlockOffsets(htmlContent);
  }, [htmlContent]);

  // Strip script tag from display HTML
  const displayHtml = useMemo(() => {
    return htmlContent.replace(
      /<script[^>]*id=["']block-offsets["'][^>]*>[\s\S]*?<\/script>/gi,
      ""
    );
  }, [htmlContent]);

  // Re-run highlighting when activeTarget or occurrenceIndex changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Clean up any existing marks
    cleanUpMarks(container);

    if (!activeTarget || activeTarget.occurrences.length === 0) {
      return;
    }

    const { occurrences, occurrenceIndex } = activeTarget;
    const activeOcc = occurrences[occurrenceIndex];

    if (!activeOcc) return;

    // 2. Highlight non-selected occurrences with subtle marks
    occurrences.forEach((occ, idx) => {
      if (idx !== occurrenceIndex) {
        highlightDocxRange(container, blockOffsets, occ.start, occ.end, false);
      }
    });

    // 3. Highlight selected occurrence with active marks
    const activeMarks = highlightDocxRange(
      container,
      blockOffsets,
      activeOcc.start,
      activeOcc.end,
      true
    );

    if (activeMarks.length > 0) {
      activeMarks[0].scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      // Visual mapping could not place marks in the DOM
      onVisualMappingFailed(
        `Unable to map offsets ${activeOcc.start}–${activeOcc.end} to rendered DOCX elements.`
      );
    }
  }, [activeTarget, blockOffsets, onVisualMappingFailed]);

  return (
    <div className="w-full flex justify-center py-6 px-4">
      <div
        className="w-full max-w-4xl bg-[#FCFBF8] border border-[#E7E2D9] rounded-[16px] shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-8 sm:p-14 transition-transform origin-top"
        style={{ transform: `scale(${scale})` }}
      >
        <div
          ref={containerRef}
          className="prose prose-stone max-w-none text-[#171717] font-serif text-[15px] leading-relaxed [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-[#171717] [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-[#171717] [&_p]:mb-4 [&_table]:border-collapse [&_table]:w-full [&_table]:my-4 [&_td]:border [&_td]:border-[#E7E2D9] [&_td]:p-2.5 [&_th]:border [&_th]:border-[#E7E2D9] [&_th]:p-2.5 [&_th]:bg-[#F7F5F0] [&_li]:mb-1.5"
          dangerouslySetInnerHTML={{ __html: displayHtml }}
        />
      </div>
    </div>
  );
}
