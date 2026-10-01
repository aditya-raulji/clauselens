"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Upload,
  FileText,
  MessageSquare,
  ExternalLink,
  Trash2,
  RefreshCw,
  AlertCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";

// ─── Types ────────────────────────────────────────────────────────────────────

type DocStatus = "uploading" | "extracting" | "ready" | "failed";

interface DocRow {
  id: string;
  name: string;
  mime: string;
  sizeBytes: number;
  status: DocStatus;
  statusDetail: string | null;
  errorMessage: string | null;
  pageCount: number | null;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fileType(mime: string, name: string): string {
  if (mime.includes("pdf") || name.toLowerCase().endsWith(".pdf")) return "PDF";
  if (mime.includes("wordprocessingml") || name.toLowerCase().endsWith(".docx")) return "DOCX";
  return "File";
}

/** Returns true if status is not terminal (ready | failed) */
function isLive(status: DocStatus): boolean {
  return status === "uploading" || status === "extracting";
}

/** Returns true if the doc has been stuck in extracting for > 2 minutes */
function isStaleExtracting(doc: DocRow): boolean {
  if (doc.status !== "extracting") return false;
  const age = Date.now() - new Date(doc.createdAt).getTime();
  return age > 2 * 60 * 1000;
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ doc }: { doc: DocRow }) {
  switch (doc.status) {
    case "uploading":
      return (
        <Badge variant="processing" size="sm">
          Uploading
        </Badge>
      );
    case "extracting":
      return (
        <span className="inline-flex items-center gap-1.5">
          <Badge variant="processing" size="sm">
            <Spinner size="sm" className="w-2.5 h-2.5 text-[#F97316] mr-0.5" />
            Extracting
          </Badge>
        </span>
      );
    case "ready":
      return (
        <Badge variant="verified" size="sm">
          Ready
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="unverified" size="sm">
          Failed
        </Badge>
      );
  }
}

// ─── Document Row ─────────────────────────────────────────────────────────────

interface DocRowProps {
  doc: DocRow;
  onDelete: (doc: DocRow) => void;
  onRetryProcess: (doc: DocRow) => void;
}

function DocumentRow({ doc, onDelete, onRetryProcess }: DocRowProps) {
  const stale = isStaleExtracting(doc);
  const type = fileType(doc.mime, doc.name);

  return (
    <div className="bg-[#FCFBF8] border border-[#E7E2D9] rounded-[16px] p-4 sm:p-5 hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-shadow">
      {/* Top row */}
      <div className="flex items-start gap-3">
        {/* File icon */}
        <div className="w-10 h-10 rounded-[10px] bg-[#F7F5F0] border border-[#E7E2D9] flex items-center justify-center text-[#77736C] shrink-0 mt-0.5">
          <FileText className="w-5 h-5" />
        </div>

        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <span className="text-sm font-medium text-[#171717] truncate max-w-[260px]">
              {doc.name}
            </span>
            <StatusBadge doc={doc} />
          </div>

          <div className="flex items-center flex-wrap gap-2 mt-1 text-xs text-[#77736C]">
            <span className="inline-flex items-center gap-1">
              <span className="font-medium">{type}</span>
            </span>
            <span>·</span>
            <span>{formatBytes(doc.sizeBytes)}</span>
            {doc.status === "ready" && doc.pageCount != null && (
              <>
                <span>·</span>
                <span>{doc.pageCount} {doc.pageCount === 1 ? "page" : "pages"}</span>
              </>
            )}
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDate(doc.createdAt)}
            </span>
          </div>

          {/* Status detail / progress */}
          {doc.status === "uploading" && (
            <div className="mt-2">
              <ProgressBar value={40} color="orange" />
              <p className="text-[11px] text-[#77736C] mt-1">
                {doc.statusDetail || "Uploading…"}
              </p>
            </div>
          )}

          {doc.status === "extracting" && (
            <div className="mt-2">
              <p className="text-[11px] text-[#F97316] flex items-center gap-1">
                <Spinner size="sm" className="w-2.5 h-2.5 text-[#F97316]" />
                {doc.statusDetail || "Extracting text…"}
              </p>
              {stale && (
                <p className="text-[11px] text-[#77736C] mt-1">
                  Extraction seems stalled.
                </p>
              )}
            </div>
          )}

          {doc.status === "failed" && doc.errorMessage && (
            <div className="mt-2 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 text-[#B7791F] shrink-0 mt-0.5" />
              <p className="text-[11px] text-[#B7791F] leading-relaxed">
                {doc.errorMessage}
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {doc.status === "ready" && (
            <>
              <Link href={`/documents/${doc.id}`}>
                <button
                  className="p-2 rounded-[9px] text-[#77736C] hover:text-[#171717] hover:bg-[#E7E2D9]/50 transition-colors"
                  title="Open document"
                  aria-label={`Open ${doc.name}`}
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              </Link>
              <Link href={`/chat?doc=${doc.id}`}>
                <button
                  className="p-2 rounded-[9px] text-[#77736C] hover:text-[#5267A8] hover:bg-[#5267A8]/10 transition-colors"
                  title="Chat about this document"
                  aria-label={`Chat about ${doc.name}`}
                >
                  <MessageSquare className="w-4 h-4" />
                </button>
              </Link>
            </>
          )}

          {(doc.status === "failed" || stale) && (
            <button
              onClick={() => onRetryProcess(doc)}
              className="p-2 rounded-[9px] text-[#77736C] hover:text-[#F97316] hover:bg-[#F97316]/10 transition-colors"
              title="Retry processing"
              aria-label={`Retry processing ${doc.name}`}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={() => onDelete(doc)}
            className="p-2 rounded-[9px] text-[#77736C] hover:text-red-500 hover:bg-red-50 transition-colors"
            title="Delete document"
            aria-label={`Delete ${doc.name}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function DocumentSkeleton() {
  return (
    <div className="bg-[#FCFBF8] border border-[#E7E2D9] rounded-[16px] p-5">
      <div className="flex items-start gap-3">
        <Skeleton className="w-10 h-10 rounded-[10px] shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-8 w-16 rounded-[9px]" />
      </div>
    </div>
  );
}

// ─── Main Library Component ───────────────────────────────────────────────────

export function DocumentLibrary() {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Fetch ──────────────────────────────────────────────────────────────────
  const fetchDocs = useCallback(async () => {
    try {
      const res = await fetch("/api/documents", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDocs(data.documents ?? []);
      setFetchError(null);
    } catch (err: any) {
      setFetchError(err?.message || "Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // Poll every 1.5s for non-final documents
  useEffect(() => {
    const hasLive = docs.some((d) => isLive(d.status));

    if (hasLive) {
      pollRef.current = setInterval(fetchDocs, 1500);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [docs, fetchDocs]);

  // ─── Delete ──────────────────────────────────────────────────────────────────
  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/documents/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Delete failed (HTTP ${res.status})`);
      }
      setDocs((prev) => prev.filter((d) => d.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err: any) {
      alert(`Could not delete: ${err?.message}`);
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTarget]);

  // ─── Retry ───────────────────────────────────────────────────────────────────
  const retryProcess = useCallback(async (doc: DocRow) => {
    setRetryingId(doc.id);
    try {
      // Reset to extracting state visually
      setDocs((prev) =>
        prev.map((d) =>
          d.id === doc.id
            ? { ...d, status: "extracting", statusDetail: "Retrying extraction…", errorMessage: null }
            : d
        )
      );

      const res = await fetch(`/api/documents/${doc.id}/process`, { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setDocs((prev) =>
          prev.map((d) =>
            d.id === doc.id
              ? { ...d, status: "failed", errorMessage: data?.error || "Retry failed" }
              : d
          )
        );
      }
    } finally {
      setRetryingId(null);
      // Refresh to get latest status
      fetchDocs();
    }
  }, [fetchDocs]);

  // ─── Render ──────────────────────────────────────────────────────────────────
  const liveCount = docs.filter((d) => isLive(d.status)).length;
  const readyCount = docs.filter((d) => d.status === "ready").length;

  return (
    <>
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Hero headline — Instrument Serif italic only for this headline */}
        <div className="pt-4 pb-2">
          <h1 className="hero-serif text-[52px] sm:text-[60px] text-[#171717] tracking-[-1.5px] leading-[1.08] max-w-2xl">
            Understand your contracts, clearly.
          </h1>
          <p className="text-base text-[#77736C] mt-3 max-w-lg font-normal leading-relaxed">
            Upload any PDF or DOCX agreement. Every answer is backed by exact
            verbatim quotes verified to exist in the original text.
          </p>
        </div>

        {/* Upload CTA */}
        <Link href="/documents/upload">
          <Button variant="primary" size="lg">
            <Upload className="w-4 h-4 mr-2" />
            Upload Contract
          </Button>
        </Link>

        {/* Section header */}
        <div className="flex items-center justify-between pt-2 border-t border-[#E7E2D9]">
          <h2 className="text-base font-semibold text-[#171717] tracking-tight">
            Documents
          </h2>
          <span className="text-xs text-[#77736C]">
            {loading
              ? "Loading…"
              : `${readyCount} ready${liveCount > 0 ? ` · ${liveCount} processing` : ""}`}
          </span>
        </div>

        {/* States */}
        {loading && (
          <div className="space-y-3">
            <DocumentSkeleton />
            <DocumentSkeleton />
            <DocumentSkeleton />
          </div>
        )}

        {!loading && fetchError && (
          <ErrorState
            title="Could not load documents"
            message={fetchError}
            onRetry={fetchDocs}
          />
        )}

        {!loading && !fetchError && docs.length === 0 && (
          <EmptyState
            icon={<FileText className="w-6 h-6 text-[#77736C]" />}
            title="No contracts uploaded yet"
            description="Add your first PDF or DOCX agreement to extract canonical text, view interactive pages, and start verifying clauses with the AI engine."
            action={
              <Link href="/documents/upload">
                <Button variant="primary" size="sm">
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Upload your first contract
                </Button>
              </Link>
            }
          />
        )}

        {!loading && !fetchError && docs.length > 0 && (
          <div className="space-y-3">
            {docs.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                onDelete={setDeleteTarget}
                onRetryProcess={retryProcess}
              />
            ))}
          </div>
        )}
      </div>

      {/* Delete confirm dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogHeader>
          <DialogTitle>Delete document?</DialogTitle>
          <DialogDescription>
            This will permanently delete{" "}
            <span className="font-medium text-[#171717]">
              "{deleteTarget?.name}"
            </span>{" "}
            along with all extracted pages, chunks, conversations, and messages.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDeleteTarget(null)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={confirmDelete}
            isLoading={isDeleting}
            className="bg-red-500 hover:bg-red-600 active:bg-red-700 border-red-600/20"
          >
            Delete
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
