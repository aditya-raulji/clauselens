/**
 * lib/validate.ts
 * Server-side file validation: extension + magic bytes + size limits.
 * AGENTS.md §3: validate extension AND magic bytes server-side.
 */

export const MAX_FILE_BYTES = 40 * 1024 * 1024; // 40 MB

export type FileType = "pdf" | "docx";

export interface ValidationResult {
  ok: true;
  fileType: FileType;
  mime: string;
}

export interface ValidationError {
  ok: false;
  message: string;
}

/**
 * Validate file extension from filename (lowercase).
 */
export function validateExtension(name: string): FileType | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  return null;
}

/**
 * Validate magic bytes of a buffer.
 *
 * PDF:  starts with %PDF- (hex 25 50 44 46 2D)
 * DOCX: ZIP header (50 4B 03 04) containing [Content_Types].xml or word/document.xml
 *       — we check the ZIP magic and then scan the local file headers in the first
 *       8 KB for "word/document.xml", which is present in every valid DOCX.
 */
export function validateMagicBytes(buf: Buffer): FileType | null {
  if (buf.length < 4) return null;

  // PDF magic: %PDF-
  if (
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  ) {
    return "pdf";
  }

  // ZIP / DOCX magic: PK\x03\x04
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    // Scan first 8 KB for "word/document.xml"
    const head = buf.slice(0, Math.min(buf.length, 8192)).toString("latin1");
    if (head.includes("word/document.xml")) {
      return "docx";
    }
  }

  return null;
}

/**
 * Full validation: size → extension → magic bytes.
 * Returns either a ValidationResult or ValidationError.
 */
export function validateFile(
  name: string,
  sizeBytes: number,
  buf: Buffer
): ValidationResult | ValidationError {
  if (sizeBytes > MAX_FILE_BYTES) {
    const mb = (sizeBytes / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      message: `File is ${mb} MB — ClauseLens supports files up to 40 MB.`,
    };
  }

  const extType = validateExtension(name);
  if (!extType) {
    const ext = name.includes(".") ? name.split(".").pop()! : "unknown";
    return {
      ok: false,
      message: `ClauseLens supports PDF and DOCX files only. You uploaded a .${ext} file.`,
    };
  }

  const magicType = validateMagicBytes(buf);
  if (!magicType) {
    return {
      ok: false,
      message: `The file "${name}" does not appear to be a valid PDF or DOCX (magic bytes mismatch). Please upload an unmodified PDF or DOCX.`,
    };
  }

  if (extType !== magicType) {
    return {
      ok: false,
      message: `The file "${name}" has a .${extType} extension but appears to be a ${magicType.toUpperCase()} internally. Please upload an authentic ${extType.toUpperCase()} file.`,
    };
  }

  const mime =
    extType === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  return { ok: true, fileType: extType, mime };
}
