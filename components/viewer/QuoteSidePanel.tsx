"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  MessageSquare,
  BookmarkCheck,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VerifiedQuoteItem } from "@/lib/chat/streamParser";
import { ActiveQuoteTarget } from "@/lib/viewer/types";

interface QuoteSidePanelProps {
  documentId: string;
  quotes: VerifiedQuoteItem[];
  messageContent?: string;
  messageId?: string;
  activeTarget: ActiveQuoteTarget | null;
  onSelectQuote: (quote: VerifiedQuoteItem, occurrenceIndex?: number) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function QuoteSidePanel({
  documentId,
  quotes,
  messageContent,
  messageId,
  activeTarget,
  onSelectQuote,
  isOpen,
  onToggle,
}: QuoteSidePanelProps) {
  const [activeTab, setActiveTab] = useState<"citations" | "context">(
    "citations"
  );

  const verifiedCount = quotes.filter((q) => q.status === "verified").length;

  if (!isOpen) {
    return (
      <div className="hidden lg:flex flex-col items-center py-4 bg-[#FCFBF8] border-l border-[#E7E2D9] w-12 flex-shrink-0">
        <button
          type="button"
          onClick={onToggle}
          title="Open Citations & Answer Panel"
          className="p-2 text-[#77736C] hover:text-[#171717] hover:bg-[#F7F5F0] rounded-[8px] transition-colors relative"
        >
          <ChevronLeft className="w-5 h-5" />
          {quotes.length > 0 && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#F97316]" />
          )}
        </button>

        <div className="mt-8 flex flex-col items-center gap-6">
          <span
            className="text-[11px] text-[#77736C] font-medium uppercase tracking-wider -rotate-90 select-none cursor-pointer"
            onClick={onToggle}
          >
            Citations ({quotes.length})
          </span>
        </div>
      </div>
    );
  }

  return (
    <aside className="w-80 md:w-96 bg-[#FCFBF8] border-l border-[#E7E2D9] flex flex-col h-full flex-shrink-0 z-20 shadow-[-4px_0_20px_rgba(0,0,0,0.02)]">
      {/* Header */}
      <div className="p-3.5 border-b border-[#E7E2D9] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-[8px] bg-[#F7F5F0] border border-[#E7E2D9] flex items-center justify-center text-[#F97316]">
            <BookmarkCheck className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-semibold text-[#171717] uppercase tracking-wider">
              Verification Panel
            </h2>
            <p className="text-[11px] text-[#77736C]">
              {verifiedCount} of {quotes.length} quotes code-verified
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggle}
          title="Collapse Panel"
          className="p-1.5 text-[#77736C] hover:text-[#171717] hover:bg-[#F7F5F0] rounded-[6px] transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-[#E7E2D9] bg-[#F7F5F0]/60 p-1 gap-1">
        <button
          type="button"
          onClick={() => setActiveTab("citations")}
          className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-[7px] transition-colors flex items-center justify-center gap-1.5 ${
            activeTab === "citations"
              ? "bg-[#FCFBF8] text-[#171717] shadow-xs border border-[#E7E2D9]"
              : "text-[#77736C] hover:text-[#171717]"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Citations ({quotes.length})</span>
        </button>

        {messageContent && (
          <button
            type="button"
            onClick={() => setActiveTab("context")}
            className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-[7px] transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === "context"
                ? "bg-[#FCFBF8] text-[#171717] shadow-xs border border-[#E7E2D9]"
                : "text-[#77736C] hover:text-[#171717]"
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>AI Answer</span>
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {activeTab === "citations" && (
          <>
            {quotes.length === 0 ? (
              <div className="text-center py-10 px-4 text-[#77736C]">
                <FileText className="w-8 h-8 mx-auto mb-2 text-[#77736C]/40" />
                <p className="text-xs font-medium text-[#171717]">
                  No active citations selected
                </p>
                <p className="text-[11px] mt-1 text-[#77736C]">
                  Select a quote from your chat message or click a verified citation in the conversation.
                </p>
                <div className="mt-4">
                  <Link href={`/documents/${documentId}/chat`}>
                    <Button variant="secondary" size="sm" className="text-xs">
                      <MessageSquare className="w-3.5 h-3.5 mr-1 text-[#F97316]" />
                      Open Full Chat
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              quotes.map((q) => {
                const isSelected = activeTarget?.n === q.n;
                const isVerified = q.status === "verified";
                const occCount = q.occurrences?.length || 0;

                return (
                  <div
                    key={`quote-card-${q.n}`}
                    onClick={() => onSelectQuote(q, 0)}
                    className={`p-3 rounded-[12px] border text-left transition-all cursor-pointer ${
                      isSelected
                        ? "bg-[#F97316]/5 border-[#F97316] shadow-xs ring-1 ring-[#F97316]/20"
                        : "bg-[#FCFBF8] border-[#E7E2D9] hover:border-[#171717]/30 hover:bg-[#F7F5F0]/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            isVerified
                              ? "bg-[#3F7D58]/10 text-[#3F7D58]"
                              : "bg-[#B7791F]/10 text-[#B7791F]"
                          }`}
                        >
                          {isVerified ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <AlertTriangle className="w-3 h-3" />
                          )}
                          Quote [{q.n}]
                        </span>

                        {isVerified && q.pageStart && (
                          <span className="text-[10px] text-[#77736C] bg-[#F7F5F0] border border-[#E7E2D9] px-1.5 py-0.2 rounded-[4px]">
                            {q.pageStart === q.pageEnd
                              ? `Page ${q.pageStart}`
                              : `Pages ${q.pageStart}–${q.pageEnd}`}
                          </span>
                        )}
                      </div>

                      {occCount > 1 && (
                        <span className="text-[10px] text-[#B7791F] font-medium bg-[#B7791F]/10 px-1.5 py-0.2 rounded-full">
                          {occCount} matches
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-[#171717] italic leading-relaxed pl-2 border-l-2 border-[#E7E2D9]">
                      “{q.quote}”
                    </p>

                    {!isVerified && q.reason && (
                      <p className="text-[10px] text-[#B7791F] mt-1.5">
                        {q.reason}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {activeTab === "context" && messageContent && (
          <div className="space-y-3">
            <div className="p-3 bg-[#FCFBF8] border border-[#E7E2D9] rounded-[12px]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-[#77736C]">
                  Assistant Response
                </span>
                {messageId && (
                  <span className="text-[10px] text-[#77736C] font-mono">
                    {messageId.slice(0, 8)}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#171717] leading-relaxed whitespace-pre-wrap">
                {messageContent}
              </p>
            </div>

            <div className="pt-2">
              <Link href={`/documents/${documentId}/chat`}>
                <Button variant="ghost" size="sm" className="w-full text-xs gap-1.5">
                  <ExternalLink className="w-3.5 h-3.5 text-[#F97316]" />
                  Continue this conversation
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
