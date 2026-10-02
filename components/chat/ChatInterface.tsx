"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Send, Square, ArrowLeft, FileText, MessageSquare, Plus, Trash2,
  CheckCircle2, AlertTriangle, ExternalLink, ChevronDown, ChevronUp,
  Sparkles, ArrowDown, Info, Radar, Gauge, X, GitCompare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ErrorState } from "@/components/ui/error-state";
import { VerifiedQuoteItem } from "@/lib/chat/streamParser";
import { CoverageObject } from "@/lib/coverage";
import { isExistenceOrAbsenceQuestion, ScanEstimate } from "@/lib/chat/deepScan";

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  documentIds?: string[];
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

// D1..D5 color palette — border/tint variations of the design system, no loud new colors
const DOC_LABEL_STYLES = [
  { bg: "bg-[#5267A8]/10", border: "border-[#5267A8]/30", text: "text-[#5267A8]", dot: "bg-[#5267A8]" },
  { bg: "bg-[#3F7D58]/10", border: "border-[#3F7D58]/30", text: "text-[#3F7D58]", dot: "bg-[#3F7D58]" },
  { bg: "bg-[#B7791F]/10", border: "border-[#B7791F]/30", text: "text-[#B7791F]", dot: "bg-[#B7791F]" },
  { bg: "bg-[#77736C]/10", border: "border-[#77736C]/30", text: "text-[#77736C]", dot: "bg-[#77736C]" },
  { bg: "bg-[#F97316]/10", border: "border-[#F97316]/30", text: "text-[#F97316]", dot: "bg-[#F97316]" },
];

function getDocStyle(idx: number) { return DOC_LABEL_STYLES[idx % DOC_LABEL_STYLES.length]; }
function labelIndex(label: string) { const m = label.match(/D(\d+)/i); return m ? parseInt(m[1], 10) - 1 : 0; }

const SUGGESTED_QUESTIONS = [
  "Does this agreement contain a non-compete clause?",
  "What are the termination and notice requirements?",
  "Is there an indemnification or limitation of liability cap?",
];
const MULTI_DOC_QUESTIONS = [
  "Compare the liability caps across both contracts.",
  "Where do the two agreements differ on termination?",
  "Which document has stronger IP assignment provisions?",
];

export function ChatInterface({ documentId: propDocId, initialConversationId }: ChatInterfaceProps) {
  const [docId, setDocId] = useState<string | undefined>(propDocId);
  const [pageCount, setPageCount] = useState<number>(0);
  const [chunkCount, setChunkCount] = useState<number>(0);
  const [docList, setDocList] = useState<Array<{ id: string; name: string; pageCount: number }>>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(propDocId ? [propDocId] : []);
  const isMultiDoc = selectedDocIds.length > 1;
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | undefined>(initialConversationId);
  const [messages, setMessages] = useState<ChatMessageUI[]>([]);
  const [inputQuestion, setInputQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{ currentBatch: number; totalBatches: number; pageStart: number; pageEnd: number; totalPages: number; statusText: string; } | null>(null);
  const [pendingScanConfirm, setPendingScanConfirm] = useState<{ question: string; estimate: ScanEstimate; } | null>(null);
  const [usage, setUsage] = useState<{ todayTokens: number; dailyLimit: number; percentage: number }>({ todayTokens: 0, dailyLimit: 200000, percentage: 0 });
  const [expandedCoverage, setExpandedCoverage] = useState<Record<string, boolean>>({});
  const [labelMap, setLabelMap] = useState<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // derived label maps
  const labelToDocId: Record<string, string> = {};
  const labelToName: Record<string, string> = {};
  selectedDocIds.forEach((id, i) => {
    labelToDocId[`D${i + 1}`] = id;
    const doc = docList.find((d) => d.id === id);
    if (doc) labelToName[`D${i + 1}`] = doc.name;
  });

  const fetchUsage = useCallback(async () => {
    try { const res = await fetch("/api/usage"); if (res.ok) { const data = await res.json(); setUsage(data); } } catch {}
  }, []);

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  useEffect(() => {
    async function loadDocuments() {
      try {
        const res = await fetch("/api/documents");
        if (res.ok) {
          const data = await res.json();
          const readyDocs = (data.documents || []).filter((d: any) => d.status === "ready");
          setDocList(readyDocs);
          const target = propDocId ? readyDocs.find((d: any) => d.id === propDocId) : readyDocs[0];
          if (target) {
            setDocId(target.id);
            setPageCount(target.pageCount || 0);
            setSelectedDocIds((prev) => prev.length > 0 ? prev : [target.id]);
            if (target.statusDetail) { const m = target.statusDetail.match(/(\d+)\s+clauses/i); if (m) setChunkCount(parseInt(m[1], 10)); }
          }
        }
      } catch {}
    }
    loadDocuments();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchConversations = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    try { const res = await fetch(`/api/conversations?documentId=${ids[0]}`); if (res.ok) { const data = await res.json(); setConversations(data.conversations || []); } } catch {}
  }, []);

  useEffect(() => { if (selectedDocIds.length > 0) fetchConversations(selectedDocIds); }, [selectedDocIds, fetchConversations]);

  const loadConversationMessages = useCallback(async (convId: string) => {
    try {
      setFetchError(null);
      const res = await fetch(`/api/conversations/${convId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        if (data.conversation?.documentIds?.length > 0) setSelectedDocIds(data.conversation.documentIds);
      } else setFetchError("Conversation not found");
    } catch (err: any) { setFetchError(err.message || "Failed to load conversation messages"); }
  }, []);

  useEffect(() => {
    if (activeConvId) loadConversationMessages(activeConvId);
    else setMessages([]);
  }, [activeConvId, loadConversationMessages]);

  const scrollToBottom = (b: ScrollBehavior = "smooth") => { messagesEndRef.current?.scrollIntoView({ behavior: b }); };
  useEffect(() => { if (!showScrollBottom) scrollToBottom("auto"); }, [messages, streaming, scanProgress]);
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    setShowScrollBottom(scrollHeight - (scrollTop + clientHeight) > 150);
  };

  const primaryDocId = selectedDocIds[0];
  const primaryDoc = docList.find((d) => d.id === primaryDocId);

  const toggleDocSelection = (id: string) => {
    setSelectedDocIds((prev) => {
      if (prev.includes(id)) { if (prev.length === 1) return prev; return prev.filter((d) => d !== id); }
      if (prev.length >= 5) return prev;
      return [...prev, id];
    });
    setActiveConvId(undefined);
    setMessages([]);
  };

  const handleSend = async (questionText?: string, forcedMode: "auto" | "scan" | "quick" = "auto") => {
    const q = (questionText || inputQuestion).trim();
    if (!q || streaming || selectedDocIds.length === 0) return;
    if (!isMultiDoc && forcedMode === "auto") {
      const isExistence = isExistenceOrAbsenceQuestion(q).isExistence;
      if (isExistence && pageCount >= 15 && !pendingScanConfirm) {
        try {
          const estRes = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: primaryDocId, question: q, mode: "estimate" }) });
          if (estRes.ok) { const { estimate } = await estRes.json(); setPendingScanConfirm({ question: q, estimate }); return; }
        } catch {}
      }
    }
    setPendingScanConfirm(null);
    setInputQuestion("");
    setFetchError(null);
    setStreaming(true);
    setScanProgress(null);
    setStreamStatus(isMultiDoc ? `Comparing ${selectedDocIds.length} documents…` : forcedMode === "scan" ? "Starting deep scan…" : "Analyzing query…");
    const tempUserMsgId = crypto.randomUUID();
    const tempAssistantMsgId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: tempUserMsgId, role: "user", content: q, status: "complete", createdAt: new Date().toISOString() },
      { id: tempAssistantMsgId, role: "assistant", content: "", status: "complete", isStreaming: true, quotes: [], createdAt: new Date().toISOString() },
    ]);
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    try {
      const body: any = { question: q, conversationId: activeConvId, mode: forcedMode };
      if (isMultiDoc) body.documentIds = selectedDocIds; else body.documentId = primaryDocId;
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: abortController.signal });
      if (!response.ok) { const ed = await response.json().catch(() => ({})); throw new Error(ed.error || `HTTP ${response.status}`); }
      if (!response.body) throw new Error("No response body");
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
          let eventName = "message", dataPayload = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event: ")) eventName = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataPayload = line.slice(6);
          }
          if (!dataPayload) continue;
          try {
            const parsed = JSON.parse(dataPayload);
            switch (eventName) {
              case "meta":
                if (parsed.conversationId && !activeConvId) { setActiveConvId(parsed.conversationId); fetchConversations(selectedDocIds); }
                if (parsed.labelMap) setLabelMap(parsed.labelMap);
                setMessages((prev) => prev.map((m) => m.id === tempAssistantMsgId ? { ...m, id: parsed.messageId || m.id } : m));
                break;
              case "status": setStreamStatus(parsed.text); break;
              case "scan_progress": setScanProgress(parsed); break;
              case "token": setMessages((prev) => prev.map((m) => (m.id === tempAssistantMsgId || m.isStreaming) ? { ...m, content: m.content + parsed.text } : m)); break;
              case "quotes": setMessages((prev) => prev.map((m) => (m.id === tempAssistantMsgId || m.isStreaming) ? { ...m, quotes: parsed.items } : m)); break;
              case "coverage": setMessages((prev) => prev.map((m) => (m.id === tempAssistantMsgId || m.isStreaming) ? { ...m, coverage: parsed } : m)); break;
              case "error": setMessages((prev) => prev.map((m) => (m.id === tempAssistantMsgId || m.isStreaming) ? { ...m, status: "error", content: m.content || `Error: ${parsed.message}`, isStreaming: false } : m)); setFetchError(parsed.message); break;
              case "done": setMessages((prev) => prev.map((m) => (m.id === tempAssistantMsgId || m.isStreaming) ? { ...m, isStreaming: false } : m)); fetchUsage(); break;
            }
          } catch {}
        }
      }
    } catch (err: any) {
      if (err.name === "AbortError" || abortController.signal.aborted) setMessages((prev) => prev.map((m) => m.isStreaming ? { ...m, status: "stopped", isStreaming: false } : m));
      else { setFetchError(err.message || "Failed to communicate with AI chat API"); setMessages((prev) => prev.map((m) => m.isStreaming ? { ...m, status: "error", content: m.content || "An error occurred.", isStreaming: false } : m)); }
    } finally { setStreaming(false); setStreamStatus(null); setScanProgress(null); abortControllerRef.current = null; }
  };

  const handleStop = () => { abortControllerRef.current?.abort(); };
  const handleNewChat = () => { if (streaming) handleStop(); setActiveConvId(undefined); setMessages([]); setInputQuestion(""); setFetchError(null); setPendingScanConfirm(null); setLabelMap({}); };
  const handleDeleteConversation = async (convIdToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this chat history?")) return;
    try { const res = await fetch(`/api/conversations/${convIdToDelete}`, { method: "DELETE" }); if (res.ok) { setConversations((prev) => prev.filter((c) => c.id !== convIdToDelete)); if (activeConvId === convIdToDelete) handleNewChat(); } } catch {}
  };
  const scrollToQuote = (messageId: string, quoteN: number) => {
    const el = document.getElementById(`quote-${messageId}-${quoteN}`);
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("ring-2", "ring-[#F97316]", "bg-[#F97316]/5"); setTimeout(() => el.classList.remove("ring-2", "ring-[#F97316]", "bg-[#F97316]/5"), 2000); }
  };
  const toggleCoverage = (id: string) => setExpandedCoverage((prev) => ({ ...prev, [id]: !prev[id] }));
  const renderTextWithCitations = (text: string, messageId: string, quotes?: VerifiedQuoteItem[] | null) =>
    text.split(/(\[\d+\])/g).map((part, i) => {
      const m = part.match(/\[(\d+)\]/);
      if (m) { const n = parseInt(m[1], 10); const qItem = quotes?.find((q) => q.n === n); const isV = qItem?.status === "verified"; return <button key={i} onClick={() => scrollToQuote(messageId, n)} className={`inline-flex items-center justify-center px-1.5 mx-0.5 text-[11px] font-semibold font-mono rounded-[6px] transition-colors align-baseline cursor-pointer border ${isV ? "bg-[#3F7D58]/10 text-[#3F7D58] border-[#3F7D58]/30 hover:bg-[#3F7D58]/20" : "bg-[#B7791F]/10 text-[#B7791F] border-[#B7791F]/30 hover:bg-[#B7791F]/20"}`} title={`Scroll to [${n}]`}>[{n}]</button>; }
      return part;
    });

  function resolveDocIdForQuote(q: VerifiedQuoteItem): string | undefined {
    if (q.doc) { const id = labelToDocId[q.doc] || Object.entries(labelMap).find(([, lbl]) => lbl === q.doc)?.[0]; if (id) return id; }
    return primaryDocId;
  }

  return (
    <div className="flex h-[calc(100vh-68px)] w-full overflow-hidden bg-[#F7F5F0]">
      {/* ─── LEFT SIDEBAR ─── */}
      <aside className="w-72 flex-shrink-0 border-r border-[#E7E2D9] bg-[#FCFBF8] flex flex-col">
        <div className="flex flex-col h-full overflow-hidden">
          <div className="p-4 border-b border-[#E7E2D9]">
            <div className="flex items-center justify-between mb-3">
              <Link href={primaryDocId ? `/documents/${primaryDocId}` : "/"} className="inline-flex items-center text-xs font-medium text-[#77736C] hover:text-[#171717] transition-colors">
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />{primaryDocId ? "View Document" : "Contract Library"}
              </Link>
              {primaryDocId && !isMultiDoc && <Link href={`/documents/${primaryDocId}`} className="text-xs text-[#77736C] hover:text-[#F97316]" title="Open document"><ExternalLink className="w-3.5 h-3.5" /></Link>}
            </div>
            {isMultiDoc ? (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-[8px] bg-[#5267A8]/10 border border-[#5267A8]/30 flex items-center justify-center flex-shrink-0"><GitCompare className="w-4 h-4 text-[#5267A8]" /></div>
                <div><h2 className="text-xs font-semibold text-[#171717]">Multi-Document Compare</h2><p className="text-[11px] text-[#77736C] mt-0.5">{selectedDocIds.length} contracts selected</p></div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-[8px] bg-[#F7F5F0] border border-[#E7E2D9] flex items-center justify-center flex-shrink-0"><FileText className="w-4 h-4 text-[#171717]" /></div>
                <div className="truncate flex-1">
                  <h2 className="text-xs font-semibold text-[#171717] truncate">{primaryDoc?.name || "No Contract Selected"}</h2>
                  {pageCount > 0 && <p className="text-[11px] text-[#77736C] mt-0.5">{pageCount} pages{chunkCount > 0 ? ` · ${chunkCount} clauses` : ""}</p>}
                </div>
              </div>
            )}
            <Button variant="secondary" size="sm" onClick={handleNewChat} className="w-full mt-3 flex items-center justify-center gap-1.5 text-xs">
              <Plus className="w-3.5 h-3.5 text-[#F97316]" />New Conversation
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            <div className="px-2 py-1.5 text-[11px] font-semibold text-[#77736C] uppercase tracking-wider">Chat History</div>
            {conversations.length === 0 ? (
              <div className="text-center py-6 px-3"><MessageSquare className="w-5 h-5 mx-auto text-[#77736C]/60 mb-1.5" /><p className="text-xs text-[#77736C]">No previous chats</p><p className="text-[11px] text-[#77736C]/80 mt-0.5">Ask a question to start.</p></div>
            ) : conversations.map((c) => {
              const isActive = c.id === activeConvId;
              const isMultiConv = (c.documentIds?.length ?? 0) > 1;
              return (
                <div key={c.id} onClick={() => setActiveConvId(c.id)} className={`group relative flex items-center justify-between p-2.5 rounded-[10px] text-xs cursor-pointer transition-colors ${isActive ? "bg-[#F7F5F0] text-[#171717] font-medium border border-[#E7E2D9]" : "text-[#77736C] hover:bg-[#F7F5F0]/60 hover:text-[#171717]"}`}>
                  <div className="flex items-center gap-2 truncate pr-6">
                    {isMultiConv ? <GitCompare className="w-3.5 h-3.5 flex-shrink-0 text-[#5267A8]" /> : <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 text-[#77736C]" />}
                    <span className="truncate">{c.title || "Untitled Chat"}</span>
                  </div>
                  <button onClick={(e) => handleDeleteConversation(c.id, e)} className="opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity p-1"><Trash2 className="w-3 h-3" /></button>
                </div>
              );
            })}
          </div>
          <div className="p-3 border-t border-[#E7E2D9]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-[#77736C] flex items-center gap-1"><Gauge className="w-3 h-3 text-[#5267A8]" />Daily AI Usage</span>
              <span className="text-[10px] font-mono text-[#77736C]">{usage.percentage}%</span>
            </div>
            <div className="w-full bg-[#E7E2D9] rounded-full h-1.5 overflow-hidden"><div className={`h-full transition-all duration-500 ${usage.percentage > 85 ? "bg-red-500" : "bg-[#5267A8]"}`} style={{ width: `${Math.max(2, usage.percentage)}%` }} /></div>
            <div className="flex items-center justify-between mt-1 text-[10px] text-[#77736C]"><span>{usage.todayTokens.toLocaleString()} tokens</span><span>200K quota</span></div>
          </div>
        </div>
      </aside>

      {/* ─── MAIN ─── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#F7F5F0]">
        {/* Header */}
        <header className="min-h-[56px] border-b border-[#E7E2D9] bg-[#FCFBF8] px-6 py-3 flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isMultiDoc ? (
              <>
                <GitCompare className="w-4 h-4 text-[#5267A8] flex-shrink-0" />
                <h1 className="text-sm font-semibold text-[#171717]">Multi-Document Analysis</h1>
                {selectedDocIds.map((id, i) => { const doc = docList.find((d) => d.id === id); const s = getDocStyle(i); return (
                  <span key={id} className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full border ${s.bg} ${s.border} ${s.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />D{i + 1}<span className="font-normal opacity-70 max-w-[80px] truncate">{doc?.name || id}</span>
                  </span>
                ); })}
              </>
            ) : (
              <>
                <h1 className="text-sm font-semibold text-[#171717]">{primaryDoc?.name || "Contract Q&A"}</h1>
                {pageCount > 0 && <Badge variant="neutral" size="sm">{pageCount} Pages</Badge>}
              </>
            )}
          </div>
          {primaryDocId && !isMultiDoc && (
            <Link href={`/documents/${primaryDocId}`}><Button variant="ghost" size="sm" className="text-xs"><ExternalLink className="w-3.5 h-3.5 mr-1 text-[#77736C]" />Open Viewer</Button></Link>
          )}
        </header>

        {/* Messages */}
        <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-6 space-y-6 max-w-4xl w-full mx-auto">
          {messages.length === 0 && (
            <div className="py-12 flex flex-col items-center text-center">
              <div className="w-12 h-12 rounded-[14px] bg-[#FCFBF8] border border-[#E7E2D9] flex items-center justify-center mb-4 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
                {isMultiDoc ? <GitCompare className="w-6 h-6 text-[#5267A8]" /> : <Sparkles className="w-6 h-6 text-[#F97316]" />}
              </div>
              <h3 className="text-base font-semibold text-[#171717] mb-1">{isMultiDoc ? "Cross-Document Comparison" : "Zero-Hallucination Contract Intelligence"}</h3>
              <p className="text-xs text-[#77736C] max-w-md mb-8">{isMultiDoc ? `Ask any question across ${selectedDocIds.length} documents. Every quote verified against its own document.` : "Ask any legal question. Every claim is strictly code-verified against exact quotes in the text."}</p>
              <div className="w-full max-w-lg space-y-2 text-left">
                <div className="text-[11px] font-semibold text-[#77736C] uppercase tracking-wider px-1">Suggested Questions</div>
                {(isMultiDoc ? MULTI_DOC_QUESTIONS : SUGGESTED_QUESTIONS).map((s, idx) => (
                  <button key={idx} onClick={() => handleSend(s)} className="w-full text-left p-3.5 rounded-[12px] bg-[#FCFBF8] border border-[#E7E2D9] text-xs text-[#171717] hover:border-[#F97316] hover:bg-white transition-all shadow-[0_2px_8px_rgba(0,0,0,0.02)] group flex items-center justify-between">
                    <span>{s}</span><Send className="w-3 h-3 text-[#77736C] group-hover:text-[#F97316] flex-shrink-0 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => {
            const isUser = msg.role === "user";
            const hasQuotes = msg.quotes && msg.quotes.length > 0;
            const verifiedCount = (msg.quotes || []).filter((q) => q.status === "verified").length;
            const zeroVerifiedWarning = !isUser && !msg.isStreaming && hasQuotes && verifiedCount === 0;
            const isGuardedWarning = !isUser && msg.content.includes("⚠️ Note: I only read pages");

            return (
              <div key={msg.id} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                <div className={`max-w-[85%] rounded-[16px] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] border ${isUser ? "bg-[#171717] text-white border-[#171717]" : "bg-[#FCFBF8] border-[#E7E2D9] text-[#171717]"}`}>
                  {isUser ? <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p> : (
                    <div className="space-y-3">
                      {zeroVerifiedWarning && (
                        <div className="rounded-[10px] bg-[#B7791F]/10 border border-[#B7791F]/30 p-2.5 flex items-start gap-2 text-xs text-[#B7791F]">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <span><strong>Notice:</strong> No quote could be verified against the document text. Treat with caution.</span>
                        </div>
                      )}
                      <div className="text-xs leading-relaxed text-[#171717] space-y-2 whitespace-pre-wrap">{renderTextWithCitations(msg.content, msg.id, msg.quotes)}</div>
                      {isGuardedWarning && !isMultiDoc && (
                        <div className="p-3 bg-[#5267A8]/10 border border-[#5267A8]/30 rounded-[12px] flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-xs text-[#5267A8]"><Radar className="w-4 h-4 flex-shrink-0" /><span>Verify across all {pageCount} pages?</span></div>
                          <Button variant="secondary" size="sm" onClick={() => { const idx = messages.findIndex((m) => m.id === msg.id); const pq = idx > 0 && messages[idx - 1].role === "user" ? messages[idx - 1].content : inputQuestion; handleSend(pq, "scan"); }} className="text-xs bg-white text-[#5267A8] border-[#5267A8]/40 hover:bg-[#5267A8]/15"><Radar className="w-3.5 h-3.5 mr-1 text-[#5267A8]" />Scan Full Document</Button>
                        </div>
                      )}
                      {msg.status === "stopped" && <div className="text-[11px] text-[#77736C] italic border-t border-[#E7E2D9] pt-2">Stopped before sources were listed.</div>}
                      {msg.coverage && (
                        <div className="pt-2 border-t border-[#E7E2D9]">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 flex-wrap">
                              {msg.coverage.complete ? (
                                <Badge variant="verified" size="sm"><CheckCircle2 className="w-3 h-3 mr-1" />{(msg.coverage as any).summaryText || `Read all ${msg.coverage.totalPages} pages`}</Badge>
                              ) : (
                                <Badge variant="unverified" size="sm"><AlertTriangle className="w-3 h-3 mr-1" />{(msg.coverage as any).summaryText || `Read ${msg.coverage.pagesRead.length} of ${msg.coverage.totalPages} pages`}</Badge>
                              )}
                              <button onClick={() => toggleCoverage(msg.id)} className="text-[11px] text-[#77736C] hover:text-[#171717] flex items-center gap-0.5"><span>Details</span>{expandedCoverage[msg.id] ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}</button>
                            </div>
                            {!msg.coverage.complete && !isMultiDoc && (
                              <button onClick={() => { const idx = messages.findIndex((m) => m.id === msg.id); const pq = idx > 0 && messages[idx - 1].role === "user" ? messages[idx - 1].content : inputQuestion; handleSend(pq, "scan"); }} className="text-[11px] font-medium text-[#5267A8] hover:underline flex items-center gap-1"><Radar className="w-3 h-3" />Scan Full Document</button>
                            )}
                          </div>
                          {expandedCoverage[msg.id] && (
                            <div className="mt-2.5 p-2.5 bg-[#F7F5F0] rounded-[10px] border border-[#E7E2D9] text-[11px] text-[#77736C] space-y-1">
                              <p><strong>Reading Mode:</strong> <span className="capitalize">{msg.coverage.mode}</span> ({msg.coverage.chunksRead} passages)</p>
                              <p><strong>Pages:</strong> {msg.coverage.pageRanges || "N/A"}</p>
                              {msg.coverage.summaryText && <p className="text-[10px] italic">{msg.coverage.summaryText}</p>}
                            </div>
                          )}
                        </div>
                      )}
                      {hasQuotes && msg.quotes && (
                        <div className="pt-3 border-t border-[#E7E2D9] space-y-2">
                          <div className="text-[11px] font-semibold text-[#77736C] uppercase tracking-wider">Verified Sources ({verifiedCount}/{msg.quotes.length})</div>
                          <div className="grid gap-2">
                            {msg.quotes.map((q) => {
                              const isVerified = q.status === "verified";
                              const pageLabel = q.pageStart === q.pageEnd ? `Page ${q.pageStart}` : `pp. ${q.pageStart}–${q.pageEnd}`;
                              const docLabelStr = q.doc || "";
                              const dIdx = labelIndex(docLabelStr);
                              const ds = docLabelStr ? getDocStyle(dIdx) : null;
                              const openDocId = isVerified ? resolveDocIdForQuote(q) : undefined;
                              const docDispName = labelToName[docLabelStr];
                              return (
                                <div id={`quote-${msg.id}-${q.n}`} key={q.n} className={`rounded-[12px] p-3 text-xs border transition-all ${isVerified ? "bg-[#FCFBF8] border-[#E7E2D9] hover:border-[#3F7D58]/40" : "bg-[#F7F5F0] border-[#E7E2D9]"}`}>
                                  <div className="flex items-center justify-between gap-2 mb-1.5">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {isVerified ? <Badge variant="verified" size="sm"><CheckCircle2 className="w-3 h-3 mr-1" />[{q.n}] Verified</Badge> : <Badge variant="unverified" size="sm"><AlertTriangle className="w-3 h-3 mr-1" />[{q.n}] Unverified</Badge>}
                                      {docLabelStr && ds && (
                                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold rounded-full border ${ds.bg} ${ds.border} ${ds.text}`}>
                                          <span className={`w-1 h-1 rounded-full ${ds.dot}`} />{docLabelStr}{docDispName ? `: ${docDispName.slice(0, 18)}${docDispName.length > 18 ? "…" : ""}` : ""}
                                        </span>
                                      )}
                                      {isVerified && q.pageStart && <span className="text-[11px] text-[#77736C]">{pageLabel}</span>}
                                      {isVerified && q.ambiguous && <span className="text-[10px] text-[#B7791F] bg-[#B7791F]/10 rounded-full px-1.5">Appears {q.occurrences?.length}x</span>}
                                    </div>
                                    {isVerified && openDocId && (
                                      <Link href={`/documents/${openDocId}?messageId=${msg.id}&quote=${q.n}&occ=0`} className="text-[11px] font-medium text-[#F97316] hover:underline inline-flex items-center gap-1 flex-shrink-0" title={`Open in ${docDispName || "document"}`}>
                                        Open in document<ExternalLink className="w-3 h-3" />
                                      </Link>
                                    )}
                                  </div>
                                  {isVerified ? <p className="text-[#171717] italic text-[11px] leading-relaxed bg-[#F7F5F0]/60 p-2 rounded-[8px] border border-[#E7E2D9]/60">"{q.quote}"</p> : <p className="text-[11px] text-[#77736C]">{q.reason || "Not found in the document."}</p>}
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

          {scanProgress && (
            <div className="rounded-[16px] bg-[#FCFBF8] border-2 border-[#5267A8] p-5 shadow-[0_4px_20px_rgba(82,103,168,0.08)] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#5267A8]"><Radar className="w-4 h-4 animate-spin" /><span>Deep Scanning Entire Agreement</span></div>
                <Button variant="secondary" size="sm" onClick={handleStop} className="text-xs text-red-600 hover:bg-red-50 border-red-200 h-7 px-2.5"><Square className="w-3 h-3 mr-1 fill-red-600 text-red-600" />Stop Scan</Button>
              </div>
              <div className="w-full bg-[#E7E2D9] rounded-full h-2.5 overflow-hidden"><div className="bg-[#5267A8] h-full transition-all duration-300 rounded-full" style={{ width: `${Math.min(100, Math.round((scanProgress.currentBatch / scanProgress.totalBatches) * 100))}%` }} /></div>
              <div className="flex items-center justify-between text-xs text-[#77736C]"><span>{scanProgress.statusText}</span><span className="font-mono text-[11px]">Batch {scanProgress.currentBatch}/{scanProgress.totalBatches}</span></div>
            </div>
          )}

          {pendingScanConfirm && (
            <div className="rounded-[16px] bg-[#FCFBF8] border-2 border-[#5267A8]/60 p-5 shadow-md space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#171717]"><Radar className="w-4 h-4 text-[#5267A8]" /><span>Confirm Deep Scan</span></div>
              <p className="text-xs text-[#77736C] leading-relaxed">You asked an existence question (<em>"{pendingScanConfirm.question}"</em>). Because this contract is large, answering with 100% certainty requires a full scan:</p>
              <div className="p-3 bg-[#5267A8]/10 rounded-[10px] text-xs text-[#5267A8] font-medium flex items-center gap-2"><Info className="w-4 h-4 flex-shrink-0" /><span>{pendingScanConfirm.estimate.summaryText}</span></div>
              <div className="flex items-center gap-2 pt-1">
                <Button variant="primary" size="sm" onClick={() => handleSend(pendingScanConfirm.question, "scan")} className="bg-[#5267A8] hover:bg-[#43548a] text-xs text-white"><Radar className="w-3.5 h-3.5 mr-1.5" />Run Full Deep Scan</Button>
                <Button variant="secondary" size="sm" onClick={() => { const q = pendingScanConfirm.question; setPendingScanConfirm(null); handleSend(q, "quick"); }} className="text-xs">Quick Retrieval Only</Button>
                <Button variant="ghost" size="sm" onClick={() => setPendingScanConfirm(null)} className="text-xs text-[#77736C]">Cancel</Button>
              </div>
            </div>
          )}

          {streaming && !scanProgress && (
            <div className="flex items-center gap-2 text-xs text-[#77736C] bg-[#FCFBF8] border border-[#E7E2D9] rounded-full px-3 py-1.5 w-fit shadow-sm">
              <Spinner size="sm" className="text-[#F97316]" /><span>{streamStatus || "Generating verified answer…"}</span>
            </div>
          )}
          {fetchError && <ErrorState title="Chat Error" message={fetchError} onRetry={() => handleSend()} />}
          <div ref={messagesEndRef} />
        </div>

        {showScrollBottom && (
          <button onClick={() => scrollToBottom("smooth")} className="absolute bottom-28 right-10 z-10 bg-[#171717] text-white p-2 rounded-full shadow-lg hover:bg-black transition-all flex items-center gap-1 text-xs px-3">
            <ArrowDown className="w-3.5 h-3.5" />Jump to latest
          </button>
        )}

        {/* ─── BOTTOM COMPOSER ─── */}
        <div className="p-4 border-t border-[#E7E2D9] bg-[#FCFBF8]">
          <div className="max-w-4xl mx-auto space-y-2">
            {/* Document selector chips */}
            {docList.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-semibold text-[#77736C] uppercase tracking-wider mr-1">{isMultiDoc ? "Comparing:" : "Document:"}</span>
                {docList.map((doc) => {
                  const selIdx = selectedDocIds.indexOf(doc.id);
                  const isSelected = selIdx !== -1;
                  const s = isSelected ? getDocStyle(selIdx) : null;
                  return (
                    <button key={doc.id} id={`doc-chip-${doc.id}`} onClick={() => toggleDocSelection(doc.id)} disabled={streaming}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${isSelected && s ? `${s.bg} ${s.border} ${s.text} shadow-sm` : "bg-[#F7F5F0] border-[#E7E2D9] text-[#77736C] hover:border-[#171717]/30 hover:text-[#171717]"} ${streaming ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                      title={isSelected ? `D${selIdx + 1}: ${doc.name}` : `Add ${doc.name}`}
                    >
                      {isSelected && s && <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />}
                      {isSelected ? `D${selIdx + 1}` : "+"} {doc.name.length > 20 ? doc.name.slice(0, 20) + "…" : doc.name}
                      {isSelected && selectedDocIds.length > 1 && <X className="w-3 h-3 opacity-60 hover:opacity-100" />}
                    </button>
                  );
                })}
                {selectedDocIds.length >= 5 && <span className="text-[10px] text-[#77736C] italic ml-1">Max 5 documents</span>}
              </div>
            )}
            <div className="flex items-end gap-2">
              <div className="relative flex-1 bg-[#F7F5F0] border border-[#E7E2D9] rounded-[14px] focus-within:border-[#F97316] focus-within:ring-1 focus-within:ring-[#F97316] transition-all">
                <textarea ref={textareaRef} value={inputQuestion} onChange={(e) => setInputQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  disabled={streaming || selectedDocIds.length === 0}
                  placeholder={selectedDocIds.length === 0 ? "Please select or upload a contract first" : isMultiDoc ? `Compare across ${selectedDocIds.length} documents (Enter to send)…` : "Ask a question about this contract (Enter to send, Shift+Enter for newline)…"}
                  rows={1} className="w-full bg-transparent px-4 py-3 text-xs text-[#171717] placeholder:text-[#77736C] resize-none focus:outline-none min-h-[44px] max-h-36"
                />
              </div>
              {streaming ? (
                <Button variant="primary" size="md" onClick={handleStop} className="bg-[#F97316] hover:bg-[#ea580c] h-11 px-4 rounded-[12px] flex items-center gap-1.5"><Square className="w-3.5 h-3.5 fill-white text-white" />Stop</Button>
              ) : (
                <Button variant="primary" size="md" onClick={() => handleSend()} disabled={!inputQuestion.trim() || selectedDocIds.length === 0} className="h-11 px-4 rounded-[12px] flex items-center gap-1.5"><Send className="w-3.5 h-3.5" />Send</Button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
