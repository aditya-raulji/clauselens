"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  GitCompare,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  ArrowRightLeft,
  Plus,
  Minus,
  MoveRight,
  RotateCcw,
  Clock,
  Filter,
  ArrowUpDown,
  Eye,
  EyeOff,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  AlignedClausePair,
  ChangeType,
  ClauseCategory,
  ComparisonResult,
  SignificanceLevel,
  WordDiffChunk,
} from "@/lib/compare/types";

// ── Helpers ─────────────────────────────────────────────────────────────────

type Doc = { id: string; name: string; status: string };

function sigColor(sig: SignificanceLevel) {
  switch (sig) {
    case "high": return { bg: "bg-red-50", border: "border-red-200", text: "text-red-700", dot: "bg-red-500" };
    case "medium": return { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700", dot: "bg-amber-500" };
    case "low": return { bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700", dot: "bg-blue-400" };
    default: return { bg: "bg-[#F7F5F0]", border: "border-[#E7E2D9]", text: "text-[#77736C]", dot: "bg-[#C9C4BA]" };
  }
}

function changeIcon(ct: ChangeType) {
  switch (ct) {
    case "added": return <Plus className="w-3.5 h-3.5 text-[#3F7D58]" />;
    case "removed": return <Minus className="w-3.5 h-3.5 text-red-500" />;
    case "modified": return <ArrowRightLeft className="w-3.5 h-3.5 text-[#B7791F]" />;
    case "moved": return <MoveRight className="w-3.5 h-3.5 text-[#5267A8]" />;
    default: return <CheckCircle2 className="w-3.5 h-3.5 text-[#77736C]" />;
  }
}

function changeBadgeStyle(ct: ChangeType): string {
  switch (ct) {
    case "added": return "bg-[#3F7D58]/10 text-[#3F7D58] border-[#3F7D58]/30";
    case "removed": return "bg-red-50 text-red-600 border-red-200";
    case "modified": return "bg-amber-50 text-amber-700 border-amber-200";
    case "moved": return "bg-[#5267A8]/10 text-[#5267A8] border-[#5267A8]/30";
    default: return "bg-[#F7F5F0] text-[#77736C] border-[#E7E2D9]";
  }
}

// Word-level inline diff render
function WordDiffView({ chunks }: { chunks: WordDiffChunk[] }) {
  return (
    <span className="font-mono text-[12px] leading-relaxed">
      {chunks.map((c, i) => {
        if (c.type === "equal") return <span key={i}>{c.text}</span>;
        if (c.type === "added")
          return (
            <mark key={i} className="bg-[#3F7D58]/15 text-[#3F7D58] rounded-[3px] px-0.5 not-italic">
              {c.text}
            </mark>
          );
        return (
          <del key={i} className="bg-red-100 text-red-600 rounded-[3px] px-0.5 line-through decoration-red-400">
            {c.text}
          </del>
        );
      })}
    </span>
  );
}

// ── Clause change card ───────────────────────────────────────────────────────

function ClauseCard({
  pair,
  docAId,
  docBId,
}: {
  pair: AlignedClausePair;
  docAId: string;
  docBId: string;
}) {
  const [expanded, setExpanded] = useState(pair.significance === "high" || pair.significance === "medium");
  const sig = sigColor(pair.significance);
  const isUnchanged = pair.changeType === "unchanged";

  if (isUnchanged) return null;

  return (
    <div
      className={`rounded-[14px] border ${sig.border} bg-[#FCFBF8] transition-all shadow-[0_4px_20px_rgba(0,0,0,0.04)] overflow-hidden`}
    >
      {/* Card header */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left p-4 flex items-start gap-3"
      >
        {/* Significance indicator */}
        <span className={`w-1.5 flex-shrink-0 rounded-full self-stretch ${sig.dot} opacity-80`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            {/* Change type badge */}
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full border ${changeBadgeStyle(pair.changeType)}`}>
              {changeIcon(pair.changeType)}
              {pair.changeType.charAt(0).toUpperCase() + pair.changeType.slice(1)}
            </span>

            {/* Significance badge */}
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-full border ${sig.bg} ${sig.border} ${sig.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${sig.dot}`} />
              {pair.significance.charAt(0).toUpperCase() + pair.significance.slice(1)}
            </span>

            {/* Category */}
            <span className="px-2 py-0.5 text-[11px] text-[#77736C] bg-[#F7F5F0] border border-[#E7E2D9] rounded-full">
              {pair.category.replace("_", " ")}
            </span>

            {pair.autoAssessed && (
              <span className="px-2 py-0.5 text-[10px] text-[#5267A8] bg-[#5267A8]/8 border border-[#5267A8]/20 rounded-full">
                auto-assessed
              </span>
            )}
          </div>

          {/* Label */}
          <p className="text-sm font-semibold text-[#171717] truncate">{pair.label}</p>

          {/* Summary */}
          <p className="text-[13px] text-[#77736C] mt-1 leading-relaxed">{pair.summary}</p>

          {/* Fact change chips */}
          {pair.factChanges.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {pair.factChanges.map((fc, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-medium rounded-full"
                  title={fc.description}
                >
                  <span className="font-semibold">{fc.label}:</span> {fc.before || "—"} → {fc.after || "—"}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Expand toggle */}
        <span className="flex-shrink-0 text-[#77736C]">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {/* Expanded body: side-by-side diff + links */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-[#E7E2D9] pt-4">
          {/* Why */}
          <p className="text-[12px] text-[#77736C] italic mb-4">{pair.why}</p>

          {pair.changeType === "modified" && pair.wordDiff && (
            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* Version A */}
              <div className="rounded-[10px] bg-[#FFF8F8] border border-red-100 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold text-red-500 uppercase tracking-wider">Version A (Old)</span>
                  {pair.clauseA && (
                    <Link
                      href={`/documents/${docAId}?offset=${pair.clauseA.startOffset}`}
                      className="text-[11px] text-[#F97316] hover:underline flex items-center gap-1"
                      title="View in A"
                    >
                      View <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>
                <p className="text-[12px] text-[#171717] leading-relaxed">
                  {pair.clauseA?.text || "—"}
                </p>
              </div>

              {/* Version B */}
              <div className="rounded-[10px] bg-[#F0FBF5] border border-[#3F7D58]/20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold text-[#3F7D58] uppercase tracking-wider">Version B (New)</span>
                  {pair.clauseB && (
                    <Link
                      href={`/documents/${docBId}?offset=${pair.clauseB.startOffset}`}
                      className="text-[11px] text-[#F97316] hover:underline flex items-center gap-1"
                      title="View in B"
                    >
                      View <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>
                <p className="text-[12px] text-[#171717] leading-relaxed">
                  {pair.clauseB?.text || "—"}
                </p>
              </div>
            </div>
          )}

          {/* Word-level diff for modified */}
          {pair.changeType === "modified" && pair.wordDiff && (
            <div className="rounded-[10px] bg-[#FAFAF8] border border-[#E7E2D9] p-3 mb-3">
              <p className="text-[10px] font-semibold text-[#77736C] uppercase tracking-wider mb-2">Inline Diff</p>
              <WordDiffView chunks={pair.wordDiff} />
            </div>
          )}

          {/* Added / Removed single pane */}
          {(pair.changeType === "added" || pair.changeType === "removed") && (
            <div className={`rounded-[10px] border p-3 mb-3 ${pair.changeType === "added" ? "bg-[#F0FBF5] border-[#3F7D58]/20" : "bg-[#FFF8F8] border-red-100"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${pair.changeType === "added" ? "text-[#3F7D58]" : "text-red-500"}`}>
                  {pair.changeType === "added" ? "Added Clause (Version B)" : "Removed Clause (Version A)"}
                </span>
                {pair.changeType === "added" && pair.clauseB && (
                  <Link href={`/documents/${docBId}?offset=${pair.clauseB.startOffset}`} className="text-[11px] text-[#F97316] hover:underline flex items-center gap-1">
                    View in B <ExternalLink className="w-3 h-3" />
                  </Link>
                )}
                {pair.changeType === "removed" && pair.clauseA && (
                  <Link href={`/documents/${docAId}?offset=${pair.clauseA.startOffset}`} className="text-[11px] text-[#F97316] hover:underline flex items-center gap-1">
                    View in A <ExternalLink className="w-3 h-3" />
                  </Link>
                )}
              </div>
              <p className="text-[12px] text-[#171717] leading-relaxed">
                {(pair.clauseA || pair.clauseB)?.text || "—"}
              </p>
            </div>
          )}

          {/* Moved clause */}
          {pair.changeType === "moved" && (
            <div className="rounded-[10px] bg-[#5267A8]/5 border border-[#5267A8]/20 p-3 mb-3">
              <p className="text-[10px] font-semibold text-[#5267A8] uppercase tracking-wider mb-2">
                Moved Clause — same text, different position
              </p>
              <div className="flex gap-3">
                {pair.clauseA && (
                  <Link href={`/documents/${docAId}?offset=${pair.clauseA.startOffset}`} className="text-[11px] text-[#F97316] hover:underline flex items-center gap-1">
                    View in A <ExternalLink className="w-3 h-3" />
                  </Link>
                )}
                {pair.clauseB && (
                  <Link href={`/documents/${docBId}?offset=${pair.clauseB.startOffset}`} className="text-[11px] text-[#F97316] hover:underline flex items-center gap-1">
                    View in B <ExternalLink className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page Component ──────────────────────────────────────────────────────

export default function ComparePage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [docAId, setDocAId] = useState("");
  const [docBId, setDocBId] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [pastComparisons, setPastComparisons] = useState<any[]>([]);

  // Filters
  const [sigFilter, setSigFilter] = useState<SignificanceLevel | "all">("all");
  const [typeFilter, setTypeFilter] = useState<ChangeType | "all">("all");
  const [catFilter, setCatFilter] = useState<ClauseCategory | "all">("all");
  const [hideCosmetic, setHideCosmetic] = useState(true);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load ready documents
  useEffect(() => {
    fetch("/api/documents")
      .then((r) => r.json())
      .then((d) => setDocs((d.documents || []).filter((doc: Doc) => doc.status === "ready")))
      .catch(() => {});

    fetch("/api/comparisons")
      .then((r) => r.json())
      .then((d) => setPastComparisons(d.comparisons || []))
      .catch(() => {});
  }, []);

  const handleCompare = useCallback(async () => {
    if (!docAId || !docBId) return;
    setError(null);
    setResult(null);
    setRunning(true);
    setProgress(5);
    setProgressMsg("Starting comparison…");

    // Fake progress while waiting for the server
    const fakeSteps = [
      [10, "Segmenting documents…"],
      [20, "Aligning clauses…"],
      [30, "Extracting facts…"],
      [45, "Running AI analysis (batch 1)…"],
      [60, "Running AI analysis (batch 2)…"],
      [75, "Running AI analysis (batch 3)…"],
      [88, "Finalizing…"],
    ] as const;

    let stepIdx = 0;
    pollingRef.current = setInterval(() => {
      if (stepIdx < fakeSteps.length) {
        setProgress(fakeSteps[stepIdx][0]);
        setProgressMsg(fakeSteps[stepIdx][1]);
        stepIdx++;
      }
    }, 3000);

    try {
      const res = await fetch("/api/comparisons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docAId, docBId }),
      });

      if (pollingRef.current) clearInterval(pollingRef.current);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Comparison failed");
      }

      const data = await res.json();
      setProgress(100);
      setProgressMsg("Done");
      setResult(data.result as ComparisonResult);
      setPastComparisons((prev) => [data.comparison, ...prev]);
    } catch (e: any) {
      setError(e.message || "Unknown error");
    } finally {
      if (pollingRef.current) clearInterval(pollingRef.current);
      setRunning(false);
    }
  }, [docAId, docBId]);

  function loadPast(comp: any) {
    setResult(comp.result as ComparisonResult);
    setDocAId(comp.docA);
    setDocBId(comp.docB);
    setError(null);
  }

  // Filtered changes
  const filteredChanges = (result?.changes || []).filter((c) => {
    if (c.changeType === "unchanged") return false;
    if (hideCosmetic && c.significance === "cosmetic") return false;
    if (sigFilter !== "all" && c.significance !== sigFilter) return false;
    if (typeFilter !== "all" && c.changeType !== typeFilter) return false;
    if (catFilter !== "all" && c.category !== catFilter) return false;
    return true;
  });

  const readyDocs = docs.filter((d) => d.status === "ready");

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-[#171717] tracking-tight">Compare Contracts</h1>
        <p className="text-sm text-[#77736C] mt-0.5">
          Clause-level diff with AI significance analysis and fact change detection.
        </p>
      </div>

      {/* Document Picker */}
      <div className="bg-[#FCFBF8] border border-[#E7E2D9] rounded-[16px] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
        <p className="text-sm font-semibold text-[#171717] mb-4">Select two versions to compare</p>
        {readyDocs.length < 2 ? (
          <div className="text-sm text-[#77736C]">
            You need at least 2 ready documents.{" "}
            <Link href="/documents/upload" className="text-[#F97316] hover:underline">Upload now →</Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {(["A", "B"] as const).map((side) => {
              const selectedId = side === "A" ? docAId : docBId;
              const setSelected = side === "A" ? setDocAId : setDocBId;
              const otherId = side === "A" ? docBId : docAId;
              return (
                <div key={side}>
                  <label className="text-[12px] font-semibold text-[#77736C] uppercase tracking-wider mb-1.5 block">
                    Version {side} {side === "A" ? "(older)" : "(newer)"}
                  </label>
                  <select
                    value={selectedId}
                    onChange={(e) => setSelected(e.target.value)}
                    className="w-full h-10 rounded-[12px] border border-[#E7E2D9] bg-[#F7F5F0] text-sm text-[#171717] px-3 focus:outline-none focus:ring-2 focus:ring-[#F97316]/30 focus:border-[#F97316]"
                  >
                    <option value="">Pick a document…</option>
                    {readyDocs.filter((d) => d.id !== otherId).map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button
            variant="primary"
            size="sm"
            onClick={handleCompare}
            disabled={!docAId || !docBId || running}
            className="flex items-center gap-2"
            id="compare-btn"
          >
            {running ? <Spinner className="w-4 h-4" /> : <GitCompare className="w-4 h-4" />}
            {running ? "Comparing…" : "Compare"}
          </Button>
          {running && (
            <span className="text-[13px] text-[#77736C]">{progressMsg}</span>
          )}
        </div>

        {running && (
          <div className="mt-3">
            <ProgressBar value={progress} />
          </div>
        )}

        {error && (
          <div className="mt-3 p-3 rounded-[10px] bg-red-50 border border-red-200 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/* Past Comparisons */}
      {!result && pastComparisons.length > 0 && (
        <div className="bg-[#FCFBF8] border border-[#E7E2D9] rounded-[16px] p-5">
          <p className="text-sm font-semibold text-[#171717] mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#77736C]" />
            Recent Comparisons
          </p>
          <div className="space-y-2">
            {pastComparisons.slice(0, 5).map((comp) => (
              <button
                key={comp.id}
                onClick={() => loadPast(comp)}
                className="w-full text-left p-3 rounded-[10px] border border-[#E7E2D9] hover:border-[#F97316]/40 hover:bg-[#FFF9F5] transition-colors text-sm"
              >
                <span className="font-medium text-[#171717]">
                  {comp.result?.docA?.name || "Doc A"} vs {comp.result?.docB?.name || "Doc B"}
                </span>
                <span className="text-[#77736C] text-xs ml-2">
                  {new Date(comp.createdAt).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-5">
          {/* Summary Card */}
          <div className="bg-[#FCFBF8] border border-[#E7E2D9] rounded-[16px] p-5 shadow-[0_4px_20px_rgba(0,0,0,0.04)]">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 rounded-[10px] bg-[#5267A8]/10 border border-[#5267A8]/20 flex items-center justify-center flex-shrink-0">
                <GitCompare className="w-4 h-4 text-[#5267A8]" />
              </div>
              <div className="flex-1">
                <h2 className="text-sm font-semibold text-[#171717]">What changed in substance</h2>
                <p className="text-[13px] text-[#77736C] mt-0.5">
                  {result.docA.name} → {result.docB.name}
                </p>
              </div>
            </div>

            {/* Headline */}
            <div className={`rounded-[10px] border p-3 mb-4 ${result.summary.counts.bySignificance.high > 0 ? "bg-red-50 border-red-200" : result.summary.counts.bySignificance.medium > 0 ? "bg-amber-50 border-amber-200" : "bg-[#F7F5F0] border-[#E7E2D9]"}`}>
              <p className={`text-sm font-semibold ${result.summary.counts.bySignificance.high > 0 ? "text-red-700" : result.summary.counts.bySignificance.medium > 0 ? "text-amber-700" : "text-[#77736C]"}`}>
                {result.summary.headline}
              </p>
            </div>

            {/* Count chips */}
            <div className="flex flex-wrap gap-2 mb-4">
              {[
                { label: "Modified", key: "modified", color: "bg-amber-50 border-amber-200 text-amber-700" },
                { label: "Added", key: "added", color: "bg-[#3F7D58]/10 border-[#3F7D58]/30 text-[#3F7D58]" },
                { label: "Removed", key: "removed", color: "bg-red-50 border-red-200 text-red-600" },
                { label: "Moved", key: "moved", color: "bg-[#5267A8]/10 border-[#5267A8]/30 text-[#5267A8]" },
                { label: "High significance", key: "high", sigKey: true, color: "bg-red-50 border-red-200 text-red-700" },
                { label: "Medium", key: "medium", sigKey: true, color: "bg-amber-50 border-amber-200 text-amber-700" },
              ].map(({ label, key, sigKey, color }) => {
                const count = sigKey
                  ? result.summary.counts.bySignificance[key as keyof typeof result.summary.counts.bySignificance]
                  : result.summary.counts[key as keyof typeof result.summary.counts];
                if (!count || typeof count !== "number") return null;
                return (
                  <span key={key} className={`px-2.5 py-1 rounded-full border text-[11px] font-semibold ${color}`}>
                    {count} {label}
                  </span>
                );
              })}
            </div>

            {/* Top bullets */}
            {result.summary.bullets.length > 0 && (
              <ul className="space-y-1.5">
                {result.summary.bullets.map((b, i) => (
                  <li key={i} className="text-[13px] text-[#171717] leading-relaxed">{b}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 p-3 bg-[#FCFBF8] border border-[#E7E2D9] rounded-[12px]">
            <Filter className="w-4 h-4 text-[#77736C] flex-shrink-0" />
            <select value={sigFilter} onChange={(e) => setSigFilter(e.target.value as any)} className="text-xs h-7 px-2 rounded-[8px] border border-[#E7E2D9] bg-[#F7F5F0] text-[#171717]">
              <option value="all">All significance</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="cosmetic">Cosmetic</option>
            </select>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)} className="text-xs h-7 px-2 rounded-[8px] border border-[#E7E2D9] bg-[#F7F5F0] text-[#171717]">
              <option value="all">All types</option>
              <option value="modified">Modified</option>
              <option value="added">Added</option>
              <option value="removed">Removed</option>
              <option value="moved">Moved</option>
            </select>
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value as any)} className="text-xs h-7 px-2 rounded-[8px] border border-[#E7E2D9] bg-[#F7F5F0] text-[#171717]">
              <option value="all">All categories</option>
              <option value="liability">Liability</option>
              <option value="payment">Payment</option>
              <option value="termination">Termination</option>
              <option value="confidentiality">Confidentiality</option>
              <option value="ip">IP</option>
              <option value="governing_law">Governing Law</option>
              <option value="other">Other</option>
            </select>
            <button
              type="button"
              onClick={() => setHideCosmetic((h) => !h)}
              className={`inline-flex items-center gap-1.5 text-xs h-7 px-3 rounded-[8px] border transition-colors ${hideCosmetic ? "bg-[#171717] text-white border-[#171717]" : "bg-[#F7F5F0] text-[#77736C] border-[#E7E2D9]"}`}
            >
              {hideCosmetic ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {hideCosmetic ? "Showing substance only" : "Show all"}
            </button>
            <span className="ml-auto text-[12px] text-[#77736C]">{filteredChanges.length} changes</span>
          </div>

          {/* No changes after filter */}
          {filteredChanges.length === 0 && (
            <EmptyState
              icon={<CheckCircle2 className="w-6 h-6 text-[#3F7D58]" />}
              title="No differences found"
              description={
                result.summary.counts.modified === 0 &&
                result.summary.counts.added === 0 &&
                result.summary.counts.removed === 0
                  ? "These two documents appear to be identical."
                  : "No changes match the current filters."
              }
            />
          )}

          {/* Change cards */}
          <div className="space-y-3">
            {filteredChanges.map((pair) => (
              <ClauseCard
                key={pair.id}
                pair={pair}
                docAId={result.docA.id}
                docBId={result.docB.id}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
