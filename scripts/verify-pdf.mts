// Runs the browser parser against a local PDF and prints aggregate counts only (no patient data).
// Usage: npm run verify-pdf -- path/to/file.pdf
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createParser, itemsToLines, isInternalCode } from "../src/lib/pdf/parse.ts";

const file = process.argv[2];
if (!file) {
  console.error("Usage: npm run verify-pdf -- <file.pdf>");
  process.exit(1);
}

const task = getDocument({ data: new Uint8Array(readFileSync(file)), verbosity: 0 });
const pdf = await task.promise;
const parser = createParser();
const started = performance.now();
for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const content = await page.getTextContent();
  const items = content.items.flatMap((it) =>
    "str" in it ? [{ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, height: it.height }] : [],
  );
  parser.addPage(itemsToLines(items), i);
  page.cleanup();
}
await task.destroy();
const { docs, totalPages, pagesWithoutText } = parser.finish();

const codes = docs.flatMap((d) => d.codes);
console.log({
  seconds: ((performance.now() - started) / 1000).toFixed(1),
  totalPages,
  pagesWithoutText: pagesWithoutText.length,
  documents: docs.length,
  uniquePatIds: new Set(docs.map((d) => d.patId)).size,
  missingNames: docs.filter((d) => !d.patientName).length,
  insuranceNone: docs.filter((d) => !d.primaryInsurance).length,
  insurancePrimaryOnly: docs.filter((d) => d.primaryInsurance && !d.secondaryInsurance).length,
  insurancePrimaryAndSecondary: docs.filter((d) => d.primaryInsurance && d.secondaryInsurance).length,
  totalCodes: codes.length,
  internalCodes: codes.filter(isInternalCode).length,
  docsWithWarnings: docs.filter((d) => d.warnings.length > 0).length,
  warningKinds: [...new Set(docs.flatMap((d) => d.warnings))],
});
