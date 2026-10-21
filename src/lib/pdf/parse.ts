// Rule-based parser for Denticon (PlanetDDS) "Treatment Plan" PDF exports.
//
// One PDF holds many treatment-plan documents back to back. Each document starts on a
// page whose footer reads "Page 1"; the header (patient, Pat ID, insurance) is printed
// on that first page, and procedure codes appear in the "Code" column of every page.
//
// This module has no imports and uses only type annotations, so it runs unchanged in the
// browser and under `node scripts/verify-pdf.ts`.

export type TextItemLike = { str: string; x: number; y: number; width: number; height: number };

export type PatientDoc = {
  patientName: string;
  patId: string;
  primaryInsurance: string;
  secondaryInsurance: string;
  codes: string[];
  startPage: number;
  warnings: string[];
};

export type ParseResult = {
  docs: PatientDoc[];
  totalPages: number;
  pagesWithoutText: number[];
};

// Standard CDT codes (D1234, D1234Z) and office-internal codes (ZD1234, Z1234).
const CODE_RE = /(?<![A-Za-z0-9])(ZD\d{4}|Z\d{4}|D\d{4}Z?)(?![A-Za-z0-9])/g;
const PAGE_RE = /\bPage\s+(\d+)\s*$/m;
const PAT_ID_RE = /Pat ID\s*:\s*(\d+)/;
// Values end at a wide column gap (rendered as 3+ spaces) or end of line.
const NAME_RE = /Patient\s*:[ \t]*(.*?)(?:\s{3,}|$)/m;
const PRIMARY_RE = /Primary Insurance\s*:[ \t]*(.*?)(?:\s{3,}|$)/m;
const SECONDARY_RE = /Secondary Insurance\s*:[ \t]*(.*?)(?:\s{3,}|$)/m;
// Rows of the coverage table at the end of a document ("Primary  99,999.00 ...").
const COVERAGE_PRIMARY_RE = /^\s*Primary\s+[\d,]+\.\d{2}/m;
const COVERAGE_SECONDARY_RE = /^\s*Secondary\s+[\d,]+\.\d{2}/m;

export function isInternalCode(code: string): boolean {
  return code.startsWith("Z");
}

/**
 * Rebuilds text lines from positioned PDF text items. Items on the same baseline are
 * joined left to right; a wide horizontal gap becomes three spaces so column boundaries
 * stay detectable by the regexes above.
 */
export function itemsToLines(items: TextItemLike[]): string[] {
  const sorted = items
    .filter((it) => it.str.trim() !== "")
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: TextItemLike[][] = [];
  for (const item of sorted) {
    const current = lines[lines.length - 1];
    const tolerance = Math.max(2, item.height * 0.4);
    if (current && Math.abs(current[0].y - item.y) <= tolerance) current.push(item);
    else lines.push([item]);
  }

  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x);
    let text = "";
    let lastEnd = -Infinity;
    for (const item of line) {
      if (text) {
        const gap = item.x - lastEnd;
        const charWidth = Math.max(item.height * 0.5, 2);
        if (gap > charWidth * 1.5) text = text.trimEnd() + "   ";
        else if (gap > charWidth * 0.15 && !text.endsWith(" ")) text += " ";
      }
      text += item.str;
      lastEnd = item.x + item.width;
    }
    return text.trimEnd();
  });
}

function clean(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Feed pages in order with `addPage`, then call `finish` to get one entry per document. */
type DocInProgress = PatientDoc & { coveragePrimary: boolean; coverageSecondary: boolean };

export function createParser() {
  const docs: DocInProgress[] = [];
  const pagesWithoutText: number[] = [];
  let current: DocInProgress | null = null;
  let totalPages = 0;

  function addPage(lines: string[], pageNumber: number) {
    totalPages = Math.max(totalPages, pageNumber);
    const text = lines.join("\n");
    if (text.replace(/\s/g, "").length < 20) {
      pagesWithoutText.push(pageNumber);
      return;
    }

    const footerPage = Number(text.match(PAGE_RE)?.[1] ?? NaN);
    const patId = text.match(PAT_ID_RE)?.[1] ?? "";
    const startsNewDoc =
      !current || footerPage === 1 || (patId !== "" && current.patId !== "" && patId !== current.patId);

    if (startsNewDoc) {
      current = {
        patientName: "",
        patId: "",
        primaryInsurance: "",
        secondaryInsurance: "",
        codes: [],
        startPage: pageNumber,
        warnings: [],
        coveragePrimary: false,
        coverageSecondary: false,
      };
      docs.push(current);
    }
    const doc: DocInProgress = current!;

    if (!doc.patId) doc.patId = patId;
    if (!doc.patientName) doc.patientName = clean(text.match(NAME_RE)?.[1]);
    if (!doc.primaryInsurance) doc.primaryInsurance = clean(text.match(PRIMARY_RE)?.[1]);
    if (!doc.secondaryInsurance) doc.secondaryInsurance = clean(text.match(SECONDARY_RE)?.[1]);
    doc.coveragePrimary ||= COVERAGE_PRIMARY_RE.test(text);
    doc.coverageSecondary ||= COVERAGE_SECONDARY_RE.test(text);

    for (const match of text.matchAll(CODE_RE)) doc.codes.push(match[1]);
  }

  function finish(): ParseResult {
    const result: PatientDoc[] = docs.map(({ coveragePrimary, coverageSecondary, ...doc }) => {
      const warnings = [...doc.warnings];
      if (!doc.patientName) warnings.push("Patient name not found");
      if (doc.codes.length === 0) warnings.push("No procedure codes found");
      // The coverage table at the end of the document should agree with the header labels.
      if (coveragePrimary !== Boolean(doc.primaryInsurance) || coverageSecondary !== Boolean(doc.secondaryInsurance)) {
        warnings.push("Insurance header and coverage table disagree");
      }
      return { ...doc, warnings };
    });
    return { docs: result, totalPages, pagesWithoutText };
  }

  return { addPage, finish };
}
