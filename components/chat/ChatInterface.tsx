"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Send,
  Square,
  ArrowLeft,
  FileText,
  MessageSquare,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowDown,
  Info,
  Radar,
  Gauge,
  Layers,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { VerifiedQuoteItem } from "@/lib/chat/streamParser";
import { CoverageObject } from "@/lib/coverage";
import { isExistenceOrAbsenceQuestion, ScanEstimate } from "@/lib/chat/deepScan";

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
}

export interface ChatMessageUI {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "complete" | "stopped" | "error";
  quotes?: VerifiedQuoteItem[] | null;
  coverage?: CoverageObject | null;
  createdAt?: string;
  isStreaming?: boolean;
}

interface ChatInterfaceProps {
  documentId?: string;
  initialConversationId?: string;
}

const SUGGESTED_QUESTIONS = [
  "Does this agreement contain a non-compete clause?",
  "What are the termination and notice requirements?",
  "Is there an indemnification or limitation of liability cap?",
];

export function ChatInterface({
  documentId: propDocId,
  initialConversationId,
}: ChatInterfaceProps) {
  // Document state
  const [docId, setDocId] = useState<string | undefined>(propDocId);
  const [docName, setDocName] = useState<string>("");
  const [pageCount, setPageCount] = useState<number>(0);
  const [chunkCount, setChunkCount] = useState<number>(0);
  const [docList, setDocList] = useState<Array<{ id: string; name: string; pageCount: number }>>([]);
  const [docLoading, setDocLoading] = useState(false);

  // Conversations state
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | undefined>(initialConversationId);

  // Messages state
  const [messages, setMessages] = useState<ChatMessageUI[]>([]);
  const [inputQuestion, setInputQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Deep Scan state
  const [scanProgress, setScanProgress] = useState<{
    currentBatch: number;
    totalBatches: number;
    pageStart: number;
    pageEnd: number;
    totalPages: number;
    statusText: string;
  } | null>(null);
  const [pendingScanConfirm, setPendingScanConfirm] = useState<{
    question: string;
    estimate: ScanEstimate;
  } | null>(null);

  // Usage meter state
  const [usage, setUsage] = useState<{
    todayTokens: number;
    dailyLimit: number;
    percentage: number;
  }>({ todayTokens: 0, dailyLimit: 200000, percentage: 0 });

  // Expandable coverage panels state (by messageId)
  const [expandedCoverage, setExpandedCoverage] = useState<Record<string, boolean>>({});

  // Auto-scroll state
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 1. Fetch available documents and load usage
  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      if (res.ok) {
        const data = await res.json();
        setUsage(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  useEffect(() => {
    async function loadDocuments() {
      try {
        setDocLoading(true);
        const res = await fetch("/api/documents");
        if (res.ok) {
          const data = await res.json();
          const readyDocs = (data.documents || []).filter(
            (d: any) => d.status === "ready"
          );
          setDocList(readyDocs);

          const target = docId
            ? readyDocs.find((d: any) => d.id === docId)
            : readyDocs[0];

          if (target) {
            setDocId(target.id);
            setDocName(target.name);
            setPageCount(target.pageCount || 0);

            // Fetch chunks count
            if (target.statusDetail) {
              const match = target.statusDetail.match(/(\d+)\s+clauses/i);
              if (match) setChunkCount(parseInt(match[1], 10));
            }
          }
        }
      } catch (err: any) {
        console.error("Failed to load documents:", err);
      } finally {
        setDocLoading(false);
      }
    }

    loadDocuments();
  }, [docId]);

  // 2. Fetch conversations for the active document
  const fetchConversations = useCallback(async (targetDocId: string) => {
    try {
      const res = await fetch(`/api/conversations?documentId=${targetDocId}`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (err) {
      console.error("Failed to load conversations:", err);
    }
  }, []);

  useEffect(() => {
    if (docId) {
      fetchConversations(docId);
    }
  }, [docId, fetchConversations]);

  // 3. Load messages when active conversation changes
  const loadConversationMessages = useCallback(async (convId: string) => {
    try {
      setFetchError(null);
      const res = await fetch(`/api/conversations/${convId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      } else {
        setFetchError("Conversation not found");
      }
    } catch (err: any) {
      setFetchError(err.message || "Failed to load conversation messages");
    }
  }, []);

  useEffect(() => {
    if (activeConvId) {
      loadConversationMessages(activeConvId);
    } else {
      setMessages([]);
    }
  }, [activeConvId, loadConversationMessages]);

  // 4. Auto-scroll on new message or tokens
  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    if (!showScrollBottom) {
      scrollToBottom("auto");
    }
  }, [messages, streaming, scanProgress]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const distFromBottom = scrollHeight - (scrollTop + clientHeight);
    setShowScrollBottom(distFromBottom > 150);
  };

  // 5. Send message with SSE Streaming, Deep Scan & Stop support
  const handleSend = async (
    questionText?: string,
    forcedMode: "auto" | "scan" | "quick" = "auto"
  ) => {
    const q = (questionText || inputQuestion).trim();
    if (!q || streaming || !docId) return;

    // Check if this is an existence question on a large document (>= 15 pages) and in auto mode
    const isExistence = isExistenceOrAbsenceQuestion(q).isExistence;
    if (forcedMode === "auto" && isExistence && pageCount >= 15 && !pendingScanConfirm) {
      // Fetch scan estimate and request confirmation first
      try {
        const estRes = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            documentId: docId,
            question: q,
            mode: "estimate",
          }),
        });
        if (estRes.ok) {
          const { estimate } = await estRes.json();
          setPendingScanConfirm({ question: q, estimate });
          return;
        }
      } catch {}
    }

    setPendingScanConfirm(null);
    setInputQuestion("");
    setFetchError(null);
    setStreaming(true);
    setScanProgress(null);
    setStreamStatus(
      forcedMode === "scan"
        ? "Starting full document deep scan…"
        : "Analyzing query…"
    );

    const tempUserMsgId = crypto.randomUUID();
    const tempAssistantMsgId = crypto.randomUUID();

    const userMsg: ChatMessageUI = {
      id: tempUserMsgId,
      role: "user",
      content: q,
      status: "complete",
      createdAt: new Date().toISOString(),
    };

    const assistantMsg: ChatMessageUI = {
      id: tempAssistantMsgId,
      role: "assistant",
      content: "",
      status: "complete",
      isStreaming: true,
      quotes: [],
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId: docId,
          question: q,
          conversationId: activeConvId,
          mode: forcedMode,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body received from chat stream");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const block of lines) {
          if (!block.trim()) continue;

          let eventName = "message";
          let dataPayload = "";

          const blockLines = block.split("\n");
          for (const line of blockLines) {
            if (line.startsWith("event: ")) {
              eventName = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataPayload = line.slice(6);
            }
          }

          if (!dataPayload) continue;

          try {
            const parsed = JSON.parse(dataPayload);

            switch (eventName) {
              case "meta":
                if (parsed.conversationId && !activeConvId) {
                  setActiveConvId(parsed.conversationId);
                  fetchConversations(docId);
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === tempAssistantMsgId
                      ? { ...m, id: parsed.messageId || m.id }
                      : m
                  )
                );
                break;

              case "status":
                setStreamStatus(parsed.text);
                break;

              case "scan_progress":
                setScanProgress(parsed);
                break;

              case "token":
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === tempAssistantMsgId || m.isStreaming
                      ? { ...m, content: m.content + parsed.text }
                      : m
                  )
                );
                break;

              case "quotes":
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === tempAssistantMsgId || m.isStreaming
                      ? { ...m, quotes: parsed.items }
                      : m
                  )
                );
                break;

              case "coverage":
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === tempAssistantMsgId || m.isStreaming
                      ? { ...m, coverage: parsed }
                      : m
                  )
                );
                break;

              case "error":
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === tempAssistantMsgId || m.isStreaming
                      ? {
                          ...m,
                          status: "error",
                          content:
                            m.content ||
                            `Error: ${parsed.message || "Could not generate answer."}`,
                          isStreaming: false,
                        }
                      : m
                  )
                );
                setFetchError(parsed.message);
                break;

              case "done":
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === tempAssistantMsgId || m.isStreaming
                      ? { ...m, isStreaming: false }
                      : m
                  )
                );
                fetchUsage();
                break;
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError" || abortController.signal.aborted) {
        setMessages((prev) =>
          prev.map((m) =>
            m.isStreaming
              ? {
                  ...m,
                  status: "stopped",
                  isStreaming: false,
                }
              : m
          )
        );
      } else {
        setFetchError(err.message || "Failed to communicate with AI chat API");
        setMessages((prev) =>
          prev.map((m) =>
            m.isStreaming
              ? {
                  ...m,
                  status: "error",
                  content: m.content || "An error occurred while streaming the answer.",
                  isStreaming: false,
                }
              : m
          )
        );
      }
    } finally {
      setStreaming(false);
      setStreamStatus(null);
      setScanProgress(null);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleNewChat = () => {
    if (streaming) handleStop();
    setActiveConvId(undefined);
    setMessages([]);
    setInputQuestion("");
    setFetchError(null);
    setPendingScanConfirm(null);
  };

  const handleDeleteConversation = async (convIdToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to delete this chat history?")) return;

    try {
      const res = await fetch(`/api/conversations/${convIdToDelete}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setConversations((prev) => prev.filter((c) => c.id !== convIdToDelete));
        if (activeConvId === convIdToDelete) {
          handleNewChat();
        }
      }
    } catch (err) {
      console.error("Failed to delete conversation:", err);
    }
  };

  const scrollToQuote = (messageId: string, quoteN: number) => {
    const el = document.getElementById(`quote-${messageId}-${quoteN}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-[#F97316]", "bg-[#F97316]/5");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-[#F97316]", "bg-[#F97316]/5");
      }, 2000);
    }
  };

  const toggleCoverage = (messageId: string) => {
    setExpandedCoverage((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  const renderTextWithCitations = (
    text: string,
    messageId: string,
    quotes?: VerifiedQuoteItem[] | null
  ) => {
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const n = parseInt(match[1], 10);
        const quoteItem = quotes?.find((q) => q.n === n);
        const isVerified = quoteItem?.status === "verified";

        return (
          <button
            key={i}
            onClick={() => scrollToQuote(messageId, n)}
            className={`inline-flex items-center justify-center px-1.5 py-0.2 mx-0.5 text-[11px] font-semibold font-mono rounded-[6px] transition-colors align-baseline cursor-pointer border ${
              isVerified
                ? "bg-[#3F7D58]/10 text-[#3F7D58] border-[#3F7D58]/30 hover:bg-[#3F7D58]/20"
                : "bg-[#B7791F]/10 text-[#B7791F] border-[#B7791F]/30 hover:bg-[#B7791F]/20"
            }`}
            title={`Scroll to Quote [${n}] (${isVerified ? "Verified" : "Unverified"})`}
          >
            [{n}]
          </button>
        );
      }
      return part;
    });
  };

  return (
    <div className="flex h-[calc(100vh-68px)] w-full overflow-hidden bg-[#F7F5F0]">
      {/* ─── LEFT SIDEBAR: Conversations, Usage Meter & Contract Info ─── */}
      <aside className="w-72 flex-shrink-0 border-r border-[#E7E2D9] bg-[#FCFBF8] flex flex-col justify-between">
        <div className="flex flex-col h-full overflow-hidden">
          {/* Header */}
          <div className="p-4 border-b border-[#E7E2D9]">
            <div className="flex items-center justify-between mb-3">
              <Link
                href={docId ? `/documents/${docId}` : "/"}
                className="inline-flex items-center text-xs font-medium text-[#77736C] hover:text-[#171717] transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                {docId ? "View Document" : "Contract Library"}
              </Link>

              {docId && (
                <Link
                  href={`/documents/${docId}`}
                  className="text-xs text-[#77736C] hover:text-[#F97316] transition-colors"
                  title="Open original document"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-[8px] bg-[#F7F5F0] border border-[#E7E2D9] flex items-center justify-center flex-shrink-0 text-[#171717]">
                <FileText className="w-4 h-4" />
              </div>
              <div className="truncate flex-1">
                <h2
                  className="text-xs font-semibold text-[#171717] truncate"
                  title={docName || "Select Contract"}
                >
                  {docName || "No Contract Selected"}
                </h2>
                {pageCount > 0 && (
                  <p className="text-[11px] text-[#77736C] flex items-center gap-1.5 mt-0.5">
                    <span>{pageCount} pages</span>
                    {chunkCount > 0 && <span>· {chunkCount} clauses</span>}
                  </p>
                )}
              </div>
            </div>

            {/* Document-level readiness badge */}
            {docId && (
              <div className="mt-2.5 flex items-center gap-1.5 px-2 py-1 bg-[#3F7D58]/10 border border-[#3F7D58]/20 rounded-[8px] text-[11px] text-[#3F7D58]">
                <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                <span className="font-medium truncate">
                  Ready for questions ({pageCount} pages indexed)
                </span>
              </div>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={handleNewChat}
              className="w-full mt-3 flex items-center justify-center gap-1.5 text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5 text-[#F97316]" />
              New Conversation
            </Button>
          </div>

          {/* Conversations History List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <div className="px-2 py-1.5 text-[11px] font-semibold text-[#77736C] uppercase tracking-wider">
              Chat History
            </div>

            {conversations.length === 0 ? (
              <div className="text-center py-6 px-3">
                <MessageSquare className="w-5 h-5 mx-auto text-[#77736C]/60 mb-1.5" />
                <p className="text-xs text-[#77736C]">No previous chats</p>
                <p className="text-[11px] text-[#77736C]/80 mt-0.5">
                  Ask a question to start.
                </p>
              </div>
            ) : (
              conversations.map((c) => {
                const isActive = c.id === activeConvId;
                return (
                  <div
                    key={c.id}
                    onClick={() => setActiveConvId(c.id)}
                    className={`group relative flex items-center justify-between p-2.5 rounded-[10px] text-xs cursor-pointer transition-colors ${
                      isActive
                        ? "bg-[#F7F5F0] text-[#171717] font-medium border border-[#E7E2D9]"
                        : "text-[#77736C] hover:bg-[#F7F5F0]/60 hover:text-[#171717]"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate pr-6">
                      <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 text-[#77736C]" />
                      <span className="truncate">{c.title || "Untitled Chat"}</span>
                    </div>

                    <button
                      onClick={(e) => handleDeleteConversation(c.id, e)}
                      className="opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity p-1"
                      title="Delete chat"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Usage Meter Card */}
          <div className="p-3 border-t border-[#E7E2D9] bg-[#FCFBF8]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-[#77736C] flex items-center gap-1">
                <Gauge className="w-3 h-3 text-[#5267A8]" />
                Daily AI Usage
              </span>
              <span className="text-[10px] font-mono text-[#77736C]">
                {usage.percentage}%
              </span>
            </div>

            <div className="w-full bg-[#E7E2D9] rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  usage.percentage > 85 ? "bg-red-500" : "bg-[#5267A8]"
                }`}
                style={{ width: `${Math.max(2, usage.percentage)}%` }}
              />
            </div>

            <div className="flex items-center justify-between mt-1 text-[10px] text-[#77736C]">
              <span>{usage.todayTokens.toLocaleString()} tokens</span>
              <span>200K quota</span>
            </div>
          </div>

          {/* Document Switcher dropdown if multiple documents available */}
          {docList.length > 1 && (
            <div className="p-3 border-t border-[#E7E2D9] bg-[#FCFBF8]">
              <label className="text-[10px] font-semibold text-[#77736C] uppercase tracking-wider block mb-1">
                Switch Contract
              </label>
              <select
                value={docId}
                onChange={(e) => {
                  const newId = e.target.value;
                  setDocId(newId);
                  const selected = docList.find((d) => d.id === newId);
                  if (selected) {
                    setDocName(selected.name);
                    setPageCount(selected.pageCount || 0);
                  }
                  setActiveConvId(undefined);
                }}
                className="w-full text-xs bg-[#F7F5F0] border border-[#E7E2D9] rounded-[8px] px-2 py-1.5 text-[#171717] focus:outline-none focus:ring-1 focus:ring-[#F97316]"
              >
                {docList.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </aside>

      {/* ─── MAIN CHAT AREA ─── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F7F5F0]">
        {/* Top Header Bar */}
        <header className="h-14 border-b border-[#E7E2D9] bg-[#FCFBF8] px-6 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-[#171717] tracking-tight">
              {docName ? `${docName}` : "Contract Q&A"}
            </h1>
            {pageCount > 0 && (
              <Badge variant="neutral" size="sm">
                {pageCount} Pages
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            {docId && (
              <Link href={`/documents/${docId}`}>
                <Button variant="ghost" size="sm" className="text-xs">
                  <ExternalLink className="w-3.5 h-3.5 mr-1 text-[#77736C]" />
                  Open Document Viewer
                </Button>
              </Link>
            )}
          </div>
        </header>

        {/* Messages Scroll View */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-6 py-6 space-y-6 max-w-4xl w-full mx-auto"
        >
          {/* Empty State with 3 Suggested Questions */}
          {messages.length === 0 && (
            <div className="py-12 flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-[14px] bg-[#FCFBF8] border border-[#E7E2D9] flex items-center justify-center text-[#F97316] mb-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-[#171717] tracking-tight mb-1">
                Zero-Hallucination Contract Intelligence
              </h3>
              <p className="text-xs text-[#77736C] max-w-md mb-8">
                Ask any legal question. Every claim is strictly code-verified
                against exact quotes in the text.
              </p>

              <div className="w-full max-w-lg space-y-2 text-left">
                <div className="text-[11px] font-semibold text-[#77736C] uppercase tracking-wider px-1">
                  Suggested Questions
                </div>
                {SUGGESTED_QUESTIONS.map((suggestion, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(suggestion)}
                    className="w-full text-left p-3.5 rounded-[12px] bg-[#FCFBF8] border border-[#E7E2D9] text-xs text-[#171717] hover:border-[#F97316] hover:bg-white transition-all shadow-[0_2px_8px_rgba(0,0,0,0.02)] group flex items-center justify-between"
                  >
                    <span>{suggestion}</span>
                    <Send className="w-3 h-3 text-[#77736C] group-hover:text-[#F97316] transition-colors flex-shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message Thread */}
          {messages.map((msg) => {
            const isUser = msg.role === "user";

            // Check if response claims support but 0 quotes verified
            const hasQuotes = msg.quotes && msg.quotes.length > 0;
            const verifiedQuotesCount = (msg.quotes || []).filter(
              (q) => q.status === "verified"
            ).length;
            const zeroVerifiedWarning =
              !isUser &&
              !msg.isStreaming &&
              hasQuotes &&
              verifiedQuotesCount === 0;

            const isGuardedWarning =
              !isUser && msg.content.includes("⚠️ Note: I only read pages");

            const isNotInDocument =
              !isUser &&
              /does not contain|not found in the provided excerpts|not mentioned in/i.test(
                msg.content
              );

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
              >
                {/* Message Bubble */}
                <div
                  className={`max-w-[85%] rounded-[16px] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border transition-all ${
                    isUser
                      ? "bg-[#171717] text-white border-[#171717]"
                      : "bg-[#FCFBF8] border-[#E7E2D9] text-[#171717]"
                  }`}
                >
                  {isUser ? (
                    <p className="text-xs leading-relaxed whitespace-pre-wrap">
                      {msg.content}
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {/* Zero verified warning banner */}
                      {zeroVerifiedWarning && (
                        <div className="rounded-[10px] bg-[#B7791F]/10 border border-[#B7791F]/30 p-2.5 flex items-start gap-2 text-xs text-[#B7791F]">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <span>
                            <strong>Notice:</strong> No quote in this answer could
                            be verified against the document text. Treat it with
                            caution.
                          </span>
                        </div>
                      )}

                      {/* Content with parsed citations */}
                      <div className="text-xs leading-relaxed text-[#171717] space-y-2 whitespace-pre-wrap">
                        {renderTextWithCitations(
                          msg.content,
                          msg.id,
                          msg.quotes
                        )}
                      </div>

                      {/* If the answer was guarded because coverage was incomplete, show "Scan full document" action */}
                      {isGuardedWarning && (
                        <div className="p-3 bg-[#5267A8]/10 border border-[#5267A8]/30 rounded-[12px] flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-xs text-[#5267A8]">
                            <Radar className="w-4 h-4 flex-shrink-0" />
                            <span>Verify across all {pageCount} pages?</span>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              // Find user question that preceded this answer
                              const idx = messages.findIndex((m) => m.id === msg.id);
                              const prevQuestion =
                                idx > 0 && messages[idx - 1].role === "user"
                                  ? messages[idx - 1].content
                                  : inputQuestion;
                              handleSend(prevQuestion, "scan");
                            }}
                            className="text-xs bg-white text-[#5267A8] border-[#5267A8]/40 hover:bg-[#5267A8]/15"
                          >
                            <Radar className="w-3.5 h-3.5 mr-1 text-[#5267A8]" />
                            Scan Full Document
                          </Button>
                        </div>
                      )}

                      {/* Stopped label */}
                      {msg.status === "stopped" && (
                        <div className="text-[11px] text-[#77736C] italic border-t border-[#E7E2D9] pt-2">
                          Stopped before sources were listed.
                        </div>
                      )}

                      {/* ─── Coverage Badge under every answer ─── */}
                      {msg.coverage && (
                        <div className="pt-2 border-t border-[#E7E2D9]">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {msg.coverage.complete ? (
                                <Badge variant="verified" size="sm">
                                  <CheckCircle2 className="w-3 h-3 mr-1" />
                                  Read all {msg.coverage.totalPages} pages
                                </Badge>
                              ) : (
                                <Badge variant="unverified" size="sm">
                                  <AlertTriangle className="w-3 h-3 mr-1" />
                                  Read {msg.coverage.pagesRead.length} of {msg.coverage.totalPages} pages
                                </Badge>
                              )}

                              <button
                                onClick={() => toggleCoverage(msg.id)}
                                className="text-[11px] text-[#77736C] hover:text-[#171717] flex items-center gap-0.5"
                              >
                                <span>Details</span>
                                {expandedCoverage[msg.id] ? (
                                  <ChevronUp className="w-3 h-3" />
                                ) : (
                                  <ChevronDown className="w-3 h-3" />
                                )}
                              </button>
                            </div>

                            {!msg.coverage.complete && (
                              <button
                                onClick={() => {
                                  const idx = messages.findIndex((m) => m.id === msg.id);
                                  const prevQuestion =
                                    idx > 0 && messages[idx - 1].role === "user"
                                      ? messages[idx - 1].content
                                      : inputQuestion;
                                  handleSend(prevQuestion, "scan");
                                }}
                                className="text-[11px] font-medium text-[#5267A8] hover:underline flex items-center gap-1"
                              >
                                <Radar className="w-3 h-3" />
                                Scan Full Document
                              </button>
                            )}
                          </div>

                          {/* Expandable page breakdown list */}
                          {expandedCoverage[msg.id] && (
                            <div className="mt-2.5 p-2.5 bg-[#F7F5F0] rounded-[10px] border border-[#E7E2D9] text-[11px] text-[#77736C] space-y-1">
                              <p>
                                <strong>Reading Mode:</strong>{" "}
                                <span className="capitalize">{msg.coverage.mode}</span> (
                                {msg.coverage.chunksRead} passages inspected)
                              </p>
                              <p>
                                <strong>Pages Inspected:</strong>{" "}
                                {msg.coverage.pageRanges || "N/A"}
                              </p>
                              <p className="text-[10px] text-[#77736C]/90 italic">
                                {msg.coverage.summaryText}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ─── Quote Cards Section ─── */}
                      {msg.quotes && msg.quotes.length > 0 && (
                        <div className="pt-3 border-t border-[#E7E2D9] space-y-2">
                          <div className="text-[11px] font-semibold text-[#77736C] uppercase tracking-wider flex items-center justify-between">
                            <span>
                              Verified Sources ({verifiedQuotesCount}/{msg.quotes.length})
                            </span>
                          </div>

                          <div className="grid gap-2">
                            {msg.quotes.map((q) => {
                              const isVerified = q.status === "verified";
                              const pageLabel =
                                q.pageStart === q.pageEnd
                                  ? `Page ${q.pageStart}`
                                  : `pp. ${q.pageStart}–${q.pageEnd}`;

                              return (
                                <div
                                  id={`quote-${msg.id}-${q.n}`}
                                  key={q.n}
                                  className={`rounded-[12px] p-3 text-xs border transition-all ${
                                    isVerified
                                      ? "bg-[#FCFBF8] border-[#E7E2D9] hover:border-[#3F7D58]/40"
                                      : "bg-[#F7F5F0] border-[#E7E2D9] text-[#77736C]"
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2 mb-1.5">
                                    <div className="flex items-center gap-1.5">
                                      {isVerified ? (
                                        <Badge variant="verified" size="sm">
                                          <CheckCircle2 className="w-3 h-3 mr-1" />
                                          [{q.n}] Verified
                                        </Badge>
                                      ) : (
                                        <Badge variant="unverified" size="sm">
                                          <AlertTriangle className="w-3 h-3 mr-1" />
                                          [{q.n}] Unverified
                                        </Badge>
                                      )}

                                      {isVerified && q.pageStart && (
                                        <span className="text-[11px] text-[#77736C]">
                                          {pageLabel}
                                        </span>
                                      )}

                                      {isVerified && q.ambiguous && (
                                        <span className="text-[10px] text-[#B7791F] bg-[#B7791F]/10 rounded-full px-1.5 py-0.2">
                                          Appears {q.occurrences?.length} times
                                        </span>
                                      )}
                                    </div>

                                    {isVerified && docId && (
                                      <Link
                                        href={`/documents/${docId}?messageId=${msg.id}&quote=${q.n}&occ=0`}
                                        className="text-[11px] font-medium text-[#F97316] hover:underline inline-flex items-center gap-1"
                                      >
                                        Open in document
                                        <ExternalLink className="w-3 h-3" />
                                      </Link>
                                    )}
                                  </div>

                                  {isVerified ? (
                                    <p className="text-[#171717] italic text-[11px] leading-relaxed bg-[#F7F5F0]/60 p-2 rounded-[8px] border border-[#E7E2D9]/60">
                                      “{q.quote}”
                                    </p>
                                  ) : (
                                    <p className="text-[11px] text-[#77736C]">
                                      {q.reason ||
                                        "Not found in the document - it may be paraphrased."}
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Deep Scan Progress Bar (AI Blue) */}
          {scanProgress && (
            <div className="rounded-[16px] bg-[#FCFBF8] border-2 border-[#5267A8] p-5 shadow-[0_4px_20px_rgba(82,103,168,0.08)] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#5267A8]">
                  <Radar className="w-4 h-4 animate-spin" />
                  <span>Deep Scanning Entire Agreement</span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleStop}
                  className="text-xs text-red-600 hover:bg-red-50 border-red-200 h-7 px-2.5"
                >
                  <Square className="w-3 h-3 mr-1 fill-red-600 text-red-600" />
                  Stop Scan
                </Button>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-[#E7E2D9] rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-[#5267A8] h-full transition-all duration-300 rounded-full"
                  style={{
                    width: `${Math.min(
                      100,
                      Math.round(
                        (scanProgress.currentBatch / scanProgress.totalBatches) * 100
                      )
                    )}%`,
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-xs text-[#77736C]">
                <span>{scanProgress.statusText}</span>
                <span className="font-mono text-[11px]">
                  Batch {scanProgress.currentBatch}/{scanProgress.totalBatches}
                </span>
              </div>
            </div>
          )}

          {/* Pre-Scan Confirmation Card */}
          {pendingScanConfirm && (
            <div className="rounded-[16px] bg-[#FCFBF8] border-2 border-[#5267A8]/60 p-5 shadow-md space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#171717]">
                <Radar className="w-4 h-4 text-[#5267A8]" />
                <span>Confirm Deep Scan</span>
              </div>
              <p className="text-xs text-[#77736C] leading-relaxed">
                You asked an existence question (<em>"{pendingScanConfirm.question}"</em>).
                Because this contract is large, answering with 100% certainty requires a full scan:
              </p>
              <div className="p-3 bg-[#5267A8]/10 rounded-[10px] text-xs text-[#5267A8] font-medium flex items-center gap-2">
                <Info className="w-4 h-4 flex-shrink-0" />
                <span>{pendingScanConfirm.estimate.summaryText}</span>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleSend(pendingScanConfirm.question, "scan")}
                  className="bg-[#5267A8] hover:bg-[#43548a] text-xs text-white"
                >
                  <Radar className="w-3.5 h-3.5 mr-1.5" />
                  Run Full Deep Scan
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    const q = pendingScanConfirm.question;
                    setPendingScanConfirm(null);
                    handleSend(q, "quick");
                  }}
                  className="text-xs"
                >
                  Quick Retrieval Only
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPendingScanConfirm(null)}
                  className="text-xs text-[#77736C]"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Active Streaming Indicator */}
          {streaming && !scanProgress && (
            <div className="flex items-center gap-2 text-xs text-[#77736C] bg-[#FCFBF8] border border-[#E7E2D9] rounded-full px-3 py-1.5 w-fit shadow-sm">
              <Spinner size="sm" className="text-[#F97316]" />
              <span>{streamStatus || "Generating verified answer…"}</span>
            </div>
          )}

          {/* Error display */}
          {fetchError && (
            <ErrorState
              title="Chat Error"
              message={fetchError}
              onRetry={() => handleSend()}
            />
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Floating "Jump to latest" affordance */}
        {showScrollBottom && (
          <button
            onClick={() => scrollToBottom("smooth")}
            className="absolute bottom-28 right-10 z-10 bg-[#171717] text-white p-2 rounded-full shadow-lg hover:bg-black transition-all flex items-center gap-1 text-xs px-3"
          >
            <ArrowDown className="w-3.5 h-3.5" />
            Jump to latest
          </button>
        )}

        {/* ─── BOTTOM COMPOSER ─── */}
        <div className="p-4 border-t border-[#E7E2D9] bg-[#FCFBF8]">
          <div className="max-w-4xl mx-auto flex items-end gap-2">
            <div className="relative flex-1 bg-[#F7F5F0] border border-[#E7E2D9] rounded-[14px] focus-within:border-[#F97316] focus-within:ring-1 focus-within:ring-[#F97316] transition-all">
              <textarea
                ref={textareaRef}
                value={inputQuestion}
                onChange={(e) => setInputQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                disabled={streaming || !docId}
                placeholder={
                  docId
                    ? "Ask a question about this contract (Enter to send, Shift+Enter for newline)…"
                    : "Please select or upload a contract first"
                }
                rows={1}
                className="w-full bg-transparent px-4 py-3 text-xs text-[#171717] placeholder:text-[#77736C] resize-none focus:outline-none min-h-[44px] max-h-36"
              />
            </div>

            {/* Send / Stop Button */}
            {streaming ? (
              <Button
                variant="primary"
                size="md"
                onClick={handleStop}
                className="bg-[#F97316] hover:bg-[#ea580c] h-11 px-4 rounded-[12px] flex items-center gap-1.5"
                title="Stop generation"
              >
                <Square className="w-3.5 h-3.5 fill-white text-white" />
                Stop
              </Button>
            ) : (
              <Button
                variant="primary"
                size="md"
                onClick={() => handleSend()}
                disabled={!inputQuestion.trim() || !docId}
                className="h-11 px-4 rounded-[12px] flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
