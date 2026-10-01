"use client";

/**
 * lib/uploadDocument.ts
 *
 * Client-side chunked upload logic.
 *
 * Flow:
 *  1. POST /api/documents  → create row, get { id }
 *  2. Split file into 3 MB parts, POST each to /api/documents/[id]/parts?index=n
 *     - Reports progress via onProgress(percent 0-90)
 *     - Retries each part up to MAX_RETRIES on failure
 *  3. POST /api/documents/[id]/complete  → assembles and validates
 *  4. POST /api/documents/[id]/process   → kicks off extraction
 *     - Progress jumps to 95 then 100 when processing is done
 *
 * Throws with a human-readable message on any unrecoverable error.
 */

const PART_SIZE = 3 * 1024 * 1024; // 3 MB per part
const MAX_RETRIES = 3;

export type UploadProgressCallback = (percent: number, detail?: string) => void;

export interface UploadResult {
  id: string;
  name: string;
}

async function postPart(
  docId: string,
  partIndex: number,
  partBuffer: ArrayBuffer,
  signal?: AbortSignal
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(
        `/api/documents/${docId}/parts?index=${partIndex}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: partBuffer,
          signal,
        }
      );

      if (res.ok) return;

      const data = await res.json().catch(() => ({}));
      lastError = new Error(data?.error || `Part ${partIndex} failed (HTTP ${res.status})`);

      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        // Non-retryable client error
        throw lastError;
      }

      // Exponential backoff before retry
      await sleep(Math.min(500 * Math.pow(2, attempt), 4000));
    } catch (err: any) {
      if (err?.name === "AbortError") throw err;
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(Math.min(500 * Math.pow(2, attempt), 4000));
      }
    }
  }

  throw lastError ?? new Error(`Part ${partIndex} failed after ${MAX_RETRIES} attempts`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function uploadDocument(
  file: File,
  onProgress: UploadProgressCallback,
  signal?: AbortSignal
): Promise<UploadResult> {
  const sizeBytes = file.size;
  const mime = resolveMime(file);

  // Step 1: Create document row
  onProgress(0, "Creating document…");
  const createRes = await fetch("/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: file.name, sizeBytes, mime }),
    signal,
  });

  if (!createRes.ok) {
    const data = await createRes.json().catch(() => ({}));
    throw new Error(data?.error || "Failed to create document record");
  }

  const { id } = (await createRes.json()) as { id: string; name: string };

  // Step 2: Upload parts
  const totalParts = Math.ceil(sizeBytes / PART_SIZE);
  const fileBuffer = await file.arrayBuffer();

  for (let i = 0; i < totalParts; i++) {
    if (signal?.aborted) throw new Error("Upload cancelled");

    const start = i * PART_SIZE;
    const end = Math.min(start + PART_SIZE, sizeBytes);
    const partBuffer = fileBuffer.slice(start, end);

    // Progress: 5% - 85% spread across parts
    const partProgress = 5 + Math.round(((i) / totalParts) * 80);
    onProgress(partProgress, `Uploading part ${i + 1} of ${totalParts}…`);

    await postPart(id, i, partBuffer, signal);

    const afterProgress = 5 + Math.round(((i + 1) / totalParts) * 80);
    onProgress(afterProgress);
  }

  // Step 3: Complete (assemble + validate)
  onProgress(88, "Assembling file…");
  const completeRes = await fetch(`/api/documents/${id}/complete`, {
    method: "POST",
    signal,
  });

  if (!completeRes.ok) {
    const data = await completeRes.json().catch(() => ({}));
    throw new Error(data?.error || "Failed to complete upload");
  }

  // Step 4: Trigger extraction
  onProgress(92, "Starting text extraction…");
  const processRes = await fetch(`/api/documents/${id}/process`, {
    method: "POST",
    signal,
  });

  if (!processRes.ok) {
    const data = await processRes.json().catch(() => ({}));
    // Not fatal for the upload — the library will show "Retry processing"
    console.warn("Processing returned error:", data?.error);
  }

  onProgress(100, "Done!");
  return { id, name: file.name };
}

/**
 * Resolve MIME type from File object and filename extension.
 */
function resolveMime(file: File): string {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  // Fall back to browser-reported MIME
  return file.type || "application/octet-stream";
}
