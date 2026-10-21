// Runs entirely in the browser: the PDF is never uploaded. pdf.js does the heavy parsing in
// its own Web Worker, and pages are processed one at a time and released, so memory stays
// flat even for files with hundreds of pages.

import { createParser, itemsToLines, type ParseResult } from "./parse";

export async function extractTreatmentPlans(
  file: File,
  onProgress: (page: number, total: number) => void,
  signal: AbortSignal,
): Promise<ParseResult> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const abort = () => void task.destroy();
  signal.addEventListener("abort", abort);

  try {
    const pdf = await task.promise;
    const parser = createParser();
    onProgress(0, pdf.numPages);

    for (let i = 1; i <= pdf.numPages; i++) {
      signal.throwIfAborted();
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const items = content.items.flatMap((it) =>
        "str" in it
          ? [{ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, height: it.height }]
          : [],
      );
      parser.addPage(itemsToLines(items), i);
      page.cleanup();
      onProgress(i, pdf.numPages);
    }
    return parser.finish();
  } finally {
    signal.removeEventListener("abort", abort);
    await task.destroy();
  }
}
