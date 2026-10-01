"use client";

import React from "react";
import { X, FileText, CheckCircle2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PassageExcerpt } from "@/lib/viewer/fallbackExcerpt";

interface FallbackExcerptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  excerpt: PassageExcerpt;
  pageNumber?: number;
  quoteIndex?: number;
  reason?: string;
}

export function FallbackExcerptDialog({
  isOpen,
  onClose,
  excerpt,
  pageNumber,
  quoteIndex,
  reason,
}: FallbackExcerptDialogProps) {
  const [copied, setCopied] = React.useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(excerpt.quote);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#171717]/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div
        className="bg-[#FCFBF8] border border-[#E7E2D9] rounded-[16px] shadow-[0_12px_40px_rgba(0,0,0,0.12)] max-w-2xl w-full flex flex-col max-h-[85vh] overflow-hidden"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-4 border-b border-[#E7E2D9] flex items-center justify-between bg-[#F7F5F0]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[8px] bg-[#F97316]/10 text-[#F97316] flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[#171717]">
                  Passage Text (Canonical Verification)
                </h3>
                {quoteIndex && (
                  <span className="text-[11px] font-semibold bg-[#3F7D58]/10 text-[#3F7D58] px-2 py-0.5 rounded-full inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    Quote [{quoteIndex}]
                  </span>
                )}
                {pageNumber && (
                  <span className="text-[11px] font-medium bg-[#FCFBF8] border border-[#E7E2D9] text-[#77736C] px-2 py-0.5 rounded-[6px]">
                    Page {pageNumber}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#77736C] mt-0.5">
                {reason ||
                  "Zero-fail canonical text verification window (~600 chars context)."}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#77736C] hover:text-[#171717] hover:bg-[#E7E2D9]/40 rounded-[8px] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Passage Window */}
        <div className="p-5 overflow-y-auto flex-1 font-serif text-sm leading-relaxed text-[#171717]">
          <div className="bg-[#F7F5F0] p-4 rounded-[12px] border border-[#E7E2D9] whitespace-pre-wrap font-sans text-xs leading-6 text-[#77736C]">
            {excerpt.hasPrefixEllipsis && <span className="opacity-50">… </span>}
            <span>{excerpt.prefix}</span>
            <mark className="bg-[#F97316]/25 border-b-2 border-[#F97316] text-[#171717] font-medium px-1 py-0.5 rounded-xs mx-0.5">
              {excerpt.quote}
            </mark>
            <span>{excerpt.suffix}</span>
            {excerpt.hasSuffixEllipsis && <span className="opacity-50"> …</span>}
          </div>
        </div>

        {/* Footer */}
        <div className="p-3.5 border-t border-[#E7E2D9] bg-[#F7F5F0]/60 flex items-center justify-between">
          <span className="text-[11px] text-[#77736C]">
            Offsets {excerpt.start}–{excerpt.end} in canonical text
          </span>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleCopy}
              className="text-xs h-8 gap-1.5"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[#3F7D58]" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy Quote
                </>
              )}
            </Button>

            <Button variant="primary" size="sm" onClick={onClose} className="text-xs h-8">
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
