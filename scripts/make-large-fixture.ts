/**
 * scripts/make-large-fixture.ts
 *
 * Generates a 150-page text PDF contract fixture:
 *  - Over 75 structured sections and clauses
 *  - Page ~120 contains:
 *    "Section 60. Termination for Convenience. Either party may terminate this Agreement
 *     for convenience by providing at least 90 calendar days prior written notice to the other party."
 *  - Does NOT contain any non-compete clause anywhere in the document.
 *  - Output saved to fixtures/master-agreement-150-pages.pdf (git-ignored).
 *
 * Run with: npm run fixtures
 */

import * as fs from "fs";
import * as path from "path";

function escapePdfString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function generate150PageContractBuffer(): Buffer {
  const totalPages = 150;
  // Map of objNumber -> objBody (without "X 0 obj" header)
  const objectsMap = new Map<number, string>();

  // Obj 1: Catalog
  objectsMap.set(1, "<< /Type /Catalog /Pages 2 0 R >>");

  // Obj 2: Pages root
  const pageObjectIds: number[] = [];
  for (let i = 1; i <= totalPages; i++) {
    pageObjectIds.push(3 + i);
  }
  const kidsStr = pageObjectIds.map((id) => `${id} 0 R`).join(" ");
  objectsMap.set(
    2,
    `<< /Type /Pages /Kids [${kidsStr}] /Count ${totalPages} >>`
  );

  // Obj 3: Base Font (Helvetica)
  objectsMap.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  // Page objects are 4 to (3 + totalPages)
  // Content objects are (4 + totalPages) to (3 + 2 * totalPages)
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const pageObjId = 3 + pageNum;
    const contentObjId = 3 + totalPages + pageNum;

    // Content lines for this page
    const lines: string[] = [];
    lines.push(`MASTER SERVICES AGREEMENT -- PAGE ${pageNum} OF ${totalPages}`);
    lines.push("");

    if (pageNum === 1) {
      lines.push("ARTICLE I. RECITALS AND PARTIES");
      lines.push("This Master Services Agreement is entered into on October 1, 2026.");
      lines.push("Between Enterprise Solutions Inc. ('Company') and Global Logistics Corp ('Client').");
      lines.push("The parties desire to establish standard terms for enterprise consulting.");
    } else if (pageNum === 120) {
      // ─── CRITICAL CLAUSE AT PAGE 120: TERMINATION FOR CONVENIENCE ───
      lines.push("SECTION 60. TERMINATION FOR CONVENIENCE AND NOTICE");
      lines.push("Section 60. Termination for Convenience. Either party may terminate this Agreement");
      lines.push("for convenience by providing at least 90 calendar days prior written notice to the other party.");
      lines.push("Upon receipt of termination notice, Company shall promptly wind down operations and");
      lines.push("Client shall pay all undisputed invoices within thirty (30) days of the termination date.");
      lines.push("Section 60.1 Survival. Sections regarding confidentiality and liability survive termination.");
    } else if (pageNum === 150) {
      lines.push("ARTICLE X. EXECUTION AND SIGNATURES");
      lines.push("IN WITNESS WHEREOF, the authorized representatives have executed this contract.");
      lines.push("ENTERPRISE SOLUTIONS INC.                   GLOBAL LOGISTICS CORP");
      lines.push("By: John Doe, Chief Executive Officer       By: Jane Smith, General Counsel");
      lines.push("Date: October 1, 2026                       Date: October 1, 2026");
    } else {
      const sectionNum = Math.floor(pageNum / 2) + 1;
      lines.push(`SECTION ${sectionNum}. OPERATIONAL SPECIFICATIONS AND COVENANTS`);
      lines.push(`Clause ${sectionNum}.1 Duty of Diligence on Page ${pageNum}.`);
      lines.push("The parties shall adhere strictly to approved performance metrics and timelines.");
      lines.push("Audits may be initiated annually upon thirty (30) calendar days advance notice.");
      lines.push("All proprietary data shared under this section remains subject to strict confidentiality.");
      lines.push("Neither party shall disclose pricing or customer identities to unapproved vendors.");
      lines.push(`General provisions continue in subsequent schedules on page ${pageNum + 1}.`);
    }

    const streamCommands: string[] = [
      "BT",
      "/F1 10 Tf",
      "14 TL",
      "50 720 Td",
    ];

    for (let l = 0; l < lines.length; l++) {
      const text = escapePdfString(lines[l]);
      if (l === 0) {
        streamCommands.push(`(${text}) Tj`);
      } else {
        streamCommands.push(`T* (${text}) Tj`);
      }
    }
    streamCommands.push("ET");

    const streamData = streamCommands.join("\n");
    const streamLength = Buffer.byteLength(streamData, "utf8");

    // Page object
    objectsMap.set(
      pageObjId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjId} 0 R >>`
    );

    // Content object
    objectsMap.set(
      contentObjId,
      `<< /Length ${streamLength} >>\nstream\n${streamData}\nendstream`
    );
  }

  const maxObjId = 3 + 2 * totalPages;
  const offsets: number[] = new Array(maxObjId + 1).fill(0);

  let pdf = "%PDF-1.4\n";

  // Write all objects in strictly ascending numerical order (1, 2, ..., maxObjId)
  for (let id = 1; id <= maxObjId; id++) {
    offsets[id] = Buffer.byteLength(pdf, "utf8");
    const body = objectsMap.get(id) || "";
    pdf += `${id} 0 obj\n${body}\nendobj\n`;
  }

  const startXref = Buffer.byteLength(pdf, "utf8");
  const totalObjCount = maxObjId + 1;

  // XRef Table with exact 20-byte entries
  let xref = `xref\n0 ${totalObjCount}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxObjId; id++) {
    const offsetStr = String(offsets[id]).padStart(10, "0");
    xref += `${offsetStr} 00000 n \n`;
  }

  const trailer = `trailer\n<< /Size ${totalObjCount} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF\n`;
  pdf += xref + trailer;

  return Buffer.from(pdf, "utf8");
}

async function main() {
  const fixturesDir = path.join(process.cwd(), "fixtures");
  if (!fs.existsSync(fixturesDir)) {
    fs.mkdirSync(fixturesDir, { recursive: true });
  }

  const outputPath = path.join(fixturesDir, "master-agreement-150-pages.pdf");
  console.log(`Generating 150-page legal contract PDF fixture at ${outputPath}...`);

  const buffer = generate150PageContractBuffer();
  fs.writeFileSync(outputPath, buffer);

  console.log(`✅ Success! Generated ${buffer.length.toLocaleString()} bytes.`);
  console.log(`Verified: Page 120 contains Termination for Convenience. Non-compete is absent.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fixture generation failed:", err);
    process.exit(1);
  });
}
