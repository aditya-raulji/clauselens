import { describe, it, expect } from "vitest";
import {
  validateExtension,
  validateMagicBytes,
  validateFile,
  MAX_FILE_BYTES,
} from "@/lib/validate";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePdfBuffer(extra = ""): Buffer {
  // %PDF-1.7\n ... minimal valid header magic
  return Buffer.from(`%PDF-1.7\n${extra}`, "latin1");
}

function makeDocxBuffer(hasWordDoc = true): Buffer {
  // ZIP PK magic + enough content to fit in first 8KB scan
  const inner = hasWordDoc ? "word/document.xml" : "xl/workbook.xml";
  // PK\x03\x04 + filler + content marker
  const pk = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  const body = Buffer.from(inner, "latin1");
  return Buffer.concat([pk, Buffer.alloc(100), body]);
}

function makeXlsxBuffer(): Buffer {
  // ZIP magic but contains xl/workbook.xml (Excel, not DOCX)
  const pk = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  return Buffer.concat([pk, Buffer.alloc(100), Buffer.from("xl/workbook.xml")]);
}

// ─── validateExtension ────────────────────────────────────────────────────────

describe("validateExtension", () => {
  it("returns 'pdf' for .pdf", () => {
    expect(validateExtension("contract.pdf")).toBe("pdf");
    expect(validateExtension("DOCUMENT.PDF")).toBe("pdf");
  });

  it("returns 'docx' for .docx", () => {
    expect(validateExtension("agreement.docx")).toBe("docx");
    expect(validateExtension("DRAFT.DOCX")).toBe("docx");
  });

  it("returns null for unsupported extensions", () => {
    expect(validateExtension("report.xlsx")).toBeNull();
    expect(validateExtension("image.png")).toBeNull();
    expect(validateExtension("noext")).toBeNull();
    expect(validateExtension("data.csv")).toBeNull();
  });
});

// ─── validateMagicBytes ───────────────────────────────────────────────────────

describe("validateMagicBytes", () => {
  it("detects PDF magic bytes (%PDF-)", () => {
    expect(validateMagicBytes(makePdfBuffer())).toBe("pdf");
  });

  it("detects DOCX (ZIP + word/document.xml)", () => {
    expect(validateMagicBytes(makeDocxBuffer(true))).toBe("docx");
  });

  it("returns null for XLSX (ZIP without word/document.xml)", () => {
    expect(validateMagicBytes(makeXlsxBuffer())).toBeNull();
  });

  it("returns null for random bytes", () => {
    expect(validateMagicBytes(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it("returns null for a buffer that is too short", () => {
    expect(validateMagicBytes(Buffer.from([0x25, 0x50]))).toBeNull();
  });

  it("returns null for empty buffer", () => {
    expect(validateMagicBytes(Buffer.alloc(0))).toBeNull();
  });

  it("does NOT classify ZIP without word/document.xml as docx", () => {
    const pk = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const body = Buffer.alloc(200);
    expect(validateMagicBytes(Buffer.concat([pk, body]))).toBeNull();
  });
});

// ─── validateFile ─────────────────────────────────────────────────────────────

describe("validateFile", () => {
  it("accepts a valid PDF", () => {
    const buf = makePdfBuffer();
    const result = validateFile("contract.pdf", buf.length, buf);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fileType).toBe("pdf");
      expect(result.mime).toBe("application/pdf");
    }
  });

  it("accepts a valid DOCX", () => {
    const buf = makeDocxBuffer();
    const result = validateFile("agreement.docx", buf.length, buf);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fileType).toBe("docx");
    }
  });

  it("rejects a file that exceeds 40 MB", () => {
    const buf = makePdfBuffer();
    const result = validateFile("big.pdf", MAX_FILE_BYTES + 1, buf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("MB");
      expect(result.message).toContain("40");
    }
  });

  it("rejects unsupported extension with clear message", () => {
    const buf = Buffer.alloc(10);
    const result = validateFile("report.xlsx", 10, buf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(".xlsx");
      expect(result.message).toContain("ClauseLens supports PDF and DOCX");
    }
  });

  it("rejects mismatched extension/magic bytes", () => {
    // .pdf extension but DOCX magic bytes
    const docxBuf = makeDocxBuffer();
    const result = validateFile("contract.pdf", docxBuf.length, docxBuf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(".pdf");
    }
  });

  it("rejects when magic bytes don't match any known type (bad file)", () => {
    const buf = Buffer.from("this is just text, not a real pdf or docx");
    const result = validateFile("contract.pdf", buf.length, buf);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("magic bytes");
    }
  });
});
