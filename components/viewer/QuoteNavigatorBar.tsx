"use client";

import React from "react";
import {
  ChevronLeft,
  ChevronRight,
  X,
  FileSearch,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActiveQuoteTarget } from "@/lib/viewer/types";

interface QuoteNavigatorBarProps {
  target: ActiveQuoteTarget;
  activePageNumber?: number;
  onPrevOccurrence: () => void;
  onNextOccurrence: () => void;
  onClose: () => void;
  onOpenFallback: () => void;
}

export function QuoteNavigatorBar({
  target,
  activePageNumber,
  onPrevOccurrence,
  onNextOccurrence,
  onClose,
  onOpenFallback,
}: QuoteNavigatorBarProps) {
  const totalOccurrences = Math.max(1, target.occurrences.length);
  const currentOccNum = target.occurrenceIndex + 1;
  const hasMultiple = totalOccurrences > 1;

  return (
    <div className="bg-[#FCFBF8] border border-[#E7E2D9] shadow-[0_4px_20px_rgba(0,0,0,0.04)] rounded-[14px] px-4 py-2.5 flex items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
      {/* Left: Occurrence Counter & Prev/Next */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#3F7D58]/10 text-[#3F7D58] text-xs font-semibold">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Quote [{target.n}]
        </span>

        <div className="flex items-center bg-[#F7F5F0] rounded-[8px] p-0.5 border border-[#E7E2D9]">
          <button
            type="button"
            onClick={onPrevOccurrence}
            disabled={!hasMultiple}
            title="Previous occurrence"
            className="p-1 text-[#77736C] hover:text-[#171717] disabled:opacity-30 disabled:hover:text-[#77736C] rounded transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="text-xs font-medium text-[#171717] px-2 select-none">
            Occurrence {currentOccNum} of {totalOccurrences}
          </span>

          <button
            type="button"
            onClick={onNextOccurrence}
            disabled={!hasMultiple}
            title="Next occurrence"
            className="p-1 text-[#77736C] hover:text-[#171717] disabled:opacity-30 disabled:hover:text-[#77736C] rounded transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {activePageNumber && (
          <span className="text-xs font-medium text-[#77736C] bg-[#F7F5F0] border border-[#E7E2D9] px-2 py-1 rounded-[6px]">
            Page {activePageNumber}
          </span>
        )}
      </div>

      {/* Middle: Truncated Quote Text */}
      <div className="hidden md:flex items-center flex-1 max-w-xl mx-2 overflow-hidden">
        <p
          className="text-xs text-[#171717] italic truncate border-l-2 border-[#F97316] pl-2.5 py-0.5"
          title={target.quote}
        >
          “{target.quote}”
        </p>
      </div>

      {/* Right: Actions (Fallback View + Close) */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenFallback}
          title="View passage in canonical text window"
          className="text-xs text-[#77736C] hover:text-[#171717] h-8 px-2.5 gap-1.5"
        >
          <FileSearch className="w-3.5 h-3.5 text-[#F97316]" />
          <span className="hidden sm:inline">Passage View</span>
        </Button>

        <button
          type="button"
          onClick={onClose}
          title="Clear highlight (Esc)"
          className="p-1.5 text-[#77736C] hover:text-[#171717] hover:bg-[#F7F5F0] rounded-[8px] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
