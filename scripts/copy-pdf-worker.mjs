// Copies the pdf.js worker into /public so the browser loads the exact version that is installed.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const src = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(publicDir, { recursive: true });
copyFileSync(src, join(publicDir, "pdf.worker.min.mjs"));
console.log("Copied pdf.js worker to public/pdf.worker.min.mjs");
