"use client";

import React, { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  UploadCloud,
  FileText,
  X,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import clsx from "clsx";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { uploadDocument } from "@/lib/uploadDocument";

const ACCEPTED_EXTS = [".pdf", ".docx"];
const ACCEPTED_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_BYTES = 40 * 1024 * 1024;

type UploadState =
  | { phase: "idle" }
  | { phase: "file-selected"; file: File }
  | { phase: "uploading"; file: File; percent: number; detail: string }
  | { phase: "done"; docId: string; name: string }
  | { phase: "error"; message: string; file?: File };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function validateFileClient(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".pdf") && !name.endsWith(".docx")) {
    const ext = name.includes(".") ? name.split(".").pop()! : "unknown";
    return `ClauseLens supports PDF and DOCX files only. You uploaded a .${ext} file.`;
  }
  if (file.size > MAX_BYTES) {
    return `File is ${formatBytes(file.size)} — ClauseLens supports files up to 40 MB.`;
  }
  return null;
}

export default function DocumentUploadPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ phase: "idle" });
  const [isDragOver, setIsDragOver] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleFile = useCallback((file: File) => {
    const err = validateFileClient(file);
    if (err) {
      setState({ phase: "error", message: err });
      return;
    }
    setState({ phase: "file-selected", file });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset so same file can be re-selected
      e.target.value = "";
    },
    [handleFile]
  );

  const startUpload = useCallback(async () => {
    if (state.phase !== "file-selected") return;
    const { file } = state;

    abortRef.current = new AbortController();

    setState({
      phase: "uploading",
      file,
      percent: 0,
      detail: "Preparing upload…",
    });

    try {
      const result = await uploadDocument(
        file,
        (percent, detail) => {
          setState((prev) =>
            prev.phase === "uploading"
              ? { ...prev, percent, detail: detail ?? prev.detail }
              : prev
          );
        },
        abortRef.current.signal
      );

      setState({ phase: "done", docId: result.id, name: result.name });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setState({ phase: "idle" });
        return;
      }
      setState({
        phase: "error",
        message: err?.message || "Upload failed. Please try again.",
        file,
      });
    }
  }, [state]);

  const cancelUpload = () => {
    abortRef.current?.abort();
    setState({ phase: "idle" });
  };

  const reset = () => {
    abortRef.current?.abort();
    setState({ phase: "idle" });
  };

  return (
    <div className="max-w-2xl mx-auto py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-[#171717] tracking-tight">
          Upload Contract
        </h1>
        <p className="text-sm text-[#77736C] mt-1">
          Upload a PDF or DOCX agreement up to 40 MB. Text is extracted into
          canonical sections and indexed for AI-assisted analysis.
        </p>
      </div>

      {/* Drop zone */}
      {(state.phase === "idle" || state.phase === "file-selected") && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop contract file here or click to browse"
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          className={clsx(
            "border-2 border-dashed rounded-[16px] p-10 text-center transition-all cursor-pointer select-none",
            "flex flex-col items-center justify-center gap-3",
            isDragOver
              ? "border-[#F97316] bg-[#F97316]/5"
              : "border-[#E7E2D9] bg-[#F7F5F0]/60 hover:border-[#F97316]/40 hover:bg-[#F7F5F0]"
          )}
        >
          <div
            className={clsx(
              "w-14 h-14 rounded-[12px] border flex items-center justify-center transition-colors",
              isDragOver
                ? "bg-[#F97316]/10 border-[#F97316]/30 text-[#F97316]"
                : "bg-[#FCFBF8] border-[#E7E2D9] text-[#F97316]"
            )}
          >
            <UploadCloud className="w-6 h-6" />
          </div>

          <div>
            <p className="text-sm font-medium text-[#171717]">
              {isDragOver
                ? "Drop your contract here"
                : "Drag and drop your contract, or browse"}
            </p>
            <p className="text-xs text-[#77736C] mt-1">
              PDF and DOCX only · up to 40 MB
            </p>
          </div>

          <Button
            variant="primary"
            size="sm"
            onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
            type="button"
          >
            Select File
          </Button>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXTS.join(",")}
            className="hidden"
            onChange={handleInputChange}
            aria-label="File input"
          />
        </div>
      )}

      {/* File selected — preview before upload */}
      {state.phase === "file-selected" && (
        <div className="bg-[#FCFBF8] border border-[#E7E2D9] rounded-[16px] p-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-[10px] bg-[#F7F5F0] border border-[#E7E2D9] flex items-center justify-center text-[#77736C] shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[#171717] truncate">{state.file.name}</p>
            <p className="text-xs text-[#77736C] mt-0.5">
              {formatBytes(state.file.size)} ·{" "}
              {state.file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "DOCX"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={reset}
              className="p-1.5 rounded-lg text-[#77736C] hover:text-[#171717] hover:bg-[#E7E2D9]/50 transition-colors"
              aria-label="Remove file"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Upload progress */}
      {state.phase === "uploading" && (
        <div className="bg-[#FCFBF8] border border-[#E7E2D9] rounded-[16px] p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[10px] bg-[#F97316]/10 border border-[#F97316]/20 flex items-center justify-center text-[#F97316] shrink-0">
              <UploadCloud className="w-5 h-5 animate-pulse" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#171717] truncate">{state.file.name}</p>
              <p className="text-xs text-[#77736C] mt-0.5">{state.detail}</p>
            </div>
            <button
              onClick={cancelUpload}
              className="p-1.5 rounded-lg text-[#77736C] hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
              aria-label="Cancel upload"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <ProgressBar
            value={state.percent}
            showPercentage
            label={state.percent < 90 ? "Uploading" : state.percent < 100 ? "Processing" : "Done"}
            color="orange"
          />
        </div>
      )}

      {/* Success */}
      {state.phase === "done" && (
        <div className="bg-[#FCFBF8] border border-[#3F7D58]/25 rounded-[16px] p-5 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[10px] bg-[#3F7D58]/10 border border-[#3F7D58]/20 flex items-center justify-center text-[#3F7D58] shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#171717]">Upload complete!</p>
              <p className="text-xs text-[#77736C] mt-0.5 truncate">
                {state.name} is being extracted and indexed.
              </p>
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              variant="primary"
              size="sm"
              onClick={() => router.push("/")}
            >
              View Library
            </Button>
            <Button variant="secondary" size="sm" onClick={reset}>
              Upload Another
            </Button>
          </div>
        </div>
      )}

      {/* Error */}
      {state.phase === "error" && (
        <div className="bg-[#FCFBF8] border border-red-200 rounded-[16px] p-5 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-[10px] bg-red-50 border border-red-200 flex items-center justify-center text-red-500 shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-[#171717]">Upload failed</p>
              <p className="text-xs text-[#77736C] mt-1 leading-relaxed">{state.message}</p>
            </div>
          </div>
          <div className="flex gap-3">
            {state.file && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setState({ phase: "file-selected", file: state.file! });
                }}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                Retry
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={reset}>
              Choose Different File
            </Button>
          </div>
        </div>
      )}

      {/* Upload action */}
      {state.phase === "file-selected" && (
        <div className="flex justify-end">
          <Button variant="primary" size="md" onClick={startUpload}>
            <UploadCloud className="w-4 h-4 mr-2" />
            Upload Contract
          </Button>
        </div>
      )}

      {/* Format info */}
      <div className="text-xs text-[#77736C] space-y-1 border-t border-[#E7E2D9] pt-4">
        <p className="font-medium text-[#171717]">Supported formats</p>
        <ul className="space-y-0.5 list-disc list-inside">
          <li>
            <span className="font-medium">PDF</span> — Text-based PDFs. Scanned images require OCR preprocessing.
          </li>
          <li>
            <span className="font-medium">DOCX</span> — Microsoft Word format. Password-protected files are not supported.
          </li>
        </ul>
      </div>
    </div>
  );
}
