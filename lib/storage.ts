import { eq } from "drizzle-orm";
import { db } from "./db";
import { documentFiles } from "./schema";

/**
 * Contract File Storage Layer
 * Backed by Postgres bytea (document_files table) by default.
 * Designed as an abstraction so storage can later be swapped for Vercel Blob / S3.
 */

export async function saveFile(
  docId: string,
  bytes: Buffer | Uint8Array
): Promise<void> {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  await db
    .insert(documentFiles)
    .values({
      documentId: docId,
      bytes: buffer,
    })
    .onConflictDoUpdate({
      target: documentFiles.documentId,
      set: {
        bytes: buffer,
      },
    });
}

export async function getFile(docId: string): Promise<Buffer | null> {
  const rows = await db
    .select({ bytes: documentFiles.bytes })
    .from(documentFiles)
    .where(eq(documentFiles.documentId, docId))
    .limit(1);

  if (!rows || rows.length === 0 || !rows[0].bytes) {
    return null;
  }

  const fileBytes = rows[0].bytes;
  return Buffer.isBuffer(fileBytes) ? fileBytes : Buffer.from(fileBytes);
}

export async function deleteFile(docId: string): Promise<void> {
  await db.delete(documentFiles).where(eq(documentFiles.documentId, docId));
}
