/**
 * make-compare-fixture.ts
 * Generates two deterministic fixture contracts for compare pipeline testing.
 * Usage: npx tsx scripts/make-compare-fixture.ts
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const FIXTURES_DIR = join(__dirname, "../test/fixtures/compare");

mkdirSync(FIXTURES_DIR, { recursive: true });

// ── Contract Version A ───────────────────────────────────────────────────────

const contractA = `SERVICE AGREEMENT - VERSION A

PARTIES
This Service Agreement ("Agreement") is entered into between Acme Corp ("Client") and TechSolutions Ltd ("Service Provider").

1. SERVICES
1.1 The Service Provider shall provide software development services as specified in Schedule A.
1.2 All services shall be performed in a professional and workmanlike manner.

2. PAYMENT
2.1 The Client shall pay AED 50,000 per month for the services described herein.
2.2 Payment shall be made within 30 days of invoice.
2.3 Late payments shall accrue interest at 2% per month.

3. TERM
3.1 This Agreement shall commence on January 1, 2024 and shall continue for a period of 12 months.
3.2 Either party may terminate this Agreement with 30 days written notice.

4. CONFIDENTIALITY
4.1 Each party shall keep the other party's confidential information strictly confidential.
4.2 This obligation shall survive termination of this Agreement for a period of 3 years.

5. INTELLECTUAL PROPERTY
5.1 All work product developed under this Agreement shall be owned by the Client.
5.2 The Service Provider shall execute all documents necessary to perfect such ownership.

6. LIABILITY
6.1 The total liability of the Service Provider shall not exceed AED 100,000.
6.2 Neither party shall be liable for indirect or consequential damages.

7. GOVERNING LAW
7.1 This Agreement shall be governed by the laws of the Emirate of Dubai.
7.2 Any disputes shall be resolved by arbitration under the DIAC rules.

8. FORCE MAJEURE
8.1 Neither party shall be liable for any failure or delay caused by events beyond its reasonable control.
`;

// ── Contract Version B (modified) ───────────────────────────────────────────

const contractB = `SERVICE AGREEMENT - VERSION B

PARTIES
This Service Agreement ("Agreement") is entered into between Acme Corp ("Client") and TechSolutions Ltd ("Service Provider").

1. SERVICES
1.1 The Service Provider shall provide software development and consulting services as specified in Schedule A.
1.2 All services shall be performed in a professional and workmanlike manner consistent with industry standards.

2. PAYMENT
2.1 The Client shall pay AED 75,000 per month for the services described herein.
2.2 Payment shall be made within 15 days of invoice.
2.3 Late payments shall accrue interest at 1.5% per month.

3. TERM
3.1 This Agreement shall commence on March 1, 2024 and shall continue for a period of 24 months.
3.2 Either party may terminate this Agreement with 60 days written notice.

4. CONFIDENTIALITY
4.1 Each party shall keep the other party's confidential information strictly confidential.
4.2 This obligation shall survive termination of this Agreement for a period of 5 years.

5. INTELLECTUAL PROPERTY
5.1 All work product developed under this Agreement shall be owned by the Client.
5.2 The Service Provider shall execute all documents necessary to perfect such ownership.

6. LIABILITY
6.1 The total liability of the Service Provider shall not exceed AED 1,000,000.
6.2 Neither party shall be liable for indirect or consequential damages.
6.3 The Service Provider shall maintain professional indemnity insurance of at least AED 500,000.

7. GOVERNING LAW
7.1 This Agreement shall be governed by the laws of the Emirate of Dubai.
7.2 Any disputes shall be resolved by arbitration under the DIAC rules.

8. DATA PROTECTION
8.1 The Service Provider shall comply with all applicable data protection laws.
8.2 Personal data shall be processed only as necessary to perform the services.

9. FORCE MAJEURE
9.1 Neither party shall be liable for any failure or delay caused by events beyond its reasonable control.
`;

// Write fixtures
const pathA = join(FIXTURES_DIR, "contract-a.txt");
const pathB = join(FIXTURES_DIR, "contract-b.txt");

writeFileSync(pathA, contractA, "utf8");
writeFileSync(pathB, contractB, "utf8");

console.log("✅ Compare fixtures written:");
console.log(`  ${pathA}`);
console.log(`  ${pathB}`);
console.log();
console.log("Expected changes:");
console.log("  Section 1.1 - MODIFIED (consulting services added)");
console.log("  Section 1.2 - MODIFIED (industry standards added)");
console.log("  Section 2.1 - MODIFIED (AED 50,000 → AED 75,000) [HIGH: money change]");
console.log("  Section 2.2 - MODIFIED (30 days → 15 days) [MEDIUM: duration change]");
console.log("  Section 3.1 - MODIFIED (date + 12 months → 24 months) [MEDIUM: date + duration]");
console.log("  Section 3.2 - MODIFIED (30 days → 60 days) [MEDIUM: duration change]");
console.log("  Section 4.2 - MODIFIED (3 years → 5 years) [MEDIUM: duration change]");
console.log("  Section 6.1 - MODIFIED (AED 100,000 → AED 1,000,000) [HIGH: liability cap]");
console.log("  Section 6.3 - ADDED (new indemnity insurance clause) [HIGH: new obligation]");
console.log("  Section 8.  - RENAMED (Force Majeure → Section 9 in B, Data Protection added)");
console.log("  Section 8 (Data Protection) - ADDED [HIGH or MEDIUM]");
