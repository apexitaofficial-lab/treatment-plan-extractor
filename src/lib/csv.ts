// Excel-compatible CSV: UTF-8 with BOM (so accented names display correctly), CRLF line
// endings, RFC 4180 quoting, and a leading apostrophe on values Excel would run as formulas.

function escapeCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(header: string[], rows: string[][]): string {
  return "﻿" + [header, ...rows].map((r) => r.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
