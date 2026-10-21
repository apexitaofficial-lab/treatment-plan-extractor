"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  DownloadIcon,
  FileIcon,
  PencilIcon,
  SearchIcon,
  UploadIcon,
} from "@/components/icons";
import { downloadCsv, toCsv } from "@/lib/csv";
import { extractTreatmentPlans } from "@/lib/pdf/extract";
import { isInternalCode, type ParseResult } from "@/lib/pdf/parse";
import { TARGET_CODES, hasTargetCode, isTargetCode, splitCodes } from "@/lib/target-codes";

type Row = {
  id: number;
  patientName: string;
  procedureCodes: string; // comma-separated, e.g. "D0120, D1110"
  primaryInsurance: string;
  secondaryInsurance: string;
  warning: string;
};

type Status =
  | { kind: "idle" }
  | { kind: "parsing"; fileName: string; page: number; total: number }
  | { kind: "done"; fileName: string; result: ParseResult; seconds: number }
  | { kind: "error"; message: string };

const PAGE_SIZE = 100;
let nextRowId = 1;

function insuranceLabel(primary: string, secondary: string): string {
  if (primary && secondary) return `Primary: ${primary}; Secondary: ${secondary}`;
  if (primary) return `Primary: ${primary}`;
  if (secondary) return `Secondary: ${secondary}`;
  return "None";
}

/** Normalizes user-typed codes: split on commas/spaces, uppercase, rejoin with ", ". */
function normalizeCodes(value: string): string {
  return value
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((c) => c.toUpperCase())
    .join(", ");
}

/**
 * One row per patient. A patient can have several treatment-plan documents in one PDF,
 * so documents are grouped by Pat ID (or name when the ID is missing). Internal office
 * codes (ZD/Z) are not billable procedures and are left out.
 */
function rowsFromResult(result: ParseResult): Row[] {
  const byPatient = new Map<string, { row: Row; codes: string[]; warnings: Set<string> }>();
  for (const doc of result.docs) {
    const key = doc.patId || doc.patientName.trim().toLowerCase() || `doc-${doc.startPage}`;
    let entry = byPatient.get(key);
    if (!entry) {
      entry = {
        row: {
          id: nextRowId++,
          patientName: doc.patientName,
          procedureCodes: "",
          primaryInsurance: doc.primaryInsurance,
          secondaryInsurance: doc.secondaryInsurance,
          warning: "",
        },
        codes: [],
        warnings: new Set(),
      };
      byPatient.set(key, entry);
    }
    const { row } = entry;
    row.patientName ||= doc.patientName;
    row.primaryInsurance ||= doc.primaryInsurance;
    row.secondaryInsurance ||= doc.secondaryInsurance;
    entry.codes.push(...doc.codes.filter((c) => !isInternalCode(c)));
    doc.warnings.forEach((w) => entry.warnings.add(w));
  }
  return [...byPatient.values()].map(({ row, codes, warnings }) => ({
    ...row,
    procedureCodes: codes.join(", "),
    warning: [...warnings].join("; "),
  }));
}

function hasInsurance(r: Row): boolean {
  return Boolean(r.primaryInsurance.trim() || r.secondaryInsurance.trim());
}

/** How many patients have each insurance (a patient with two is counted under both). */
function patientsByInsurance(rows: Row[]) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const plans = new Set([r.primaryInsurance.trim(), r.secondaryInsurance.trim()].filter(Boolean));
    for (const name of plans) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export default function Workspace() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setStatus({ kind: "error", message: "Please choose a PDF file." });
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ kind: "parsing", fileName: file.name, page: 0, total: 0 });
    const started = performance.now();

    try {
      const result = await extractTreatmentPlans(
        file,
        (p, total) => setStatus({ kind: "parsing", fileName: file.name, page: p, total }),
        controller.signal,
      );
      setRows(rowsFromResult(result));
      setEditingId(null);
      setPage(0);
      setStatus({ kind: "done", fileName: file.name, result, seconds: (performance.now() - started) / 1000 });
    } catch (err) {
      if (controller.signal.aborted) {
        setStatus({ kind: "idle" });
        return;
      }
      const name = (err as { name?: string })?.name;
      const message =
        name === "PasswordException"
          ? "This PDF is password-protected. Remove the password and try again."
          : name === "InvalidPDFException"
            ? "This file is not a valid PDF."
            : "Could not read this PDF.";
      console.error(err);
      setStatus({ kind: "error", message });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  // Only procedure codes are editable; name and insurance come from the PDF.
  const saveRow = useCallback((id: number, procedureCodes: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, procedureCodes: normalizeCodes(procedureCodes) } : r)));
    setEditingId(null);
  }, []);

  const cancelEdit = useCallback(() => setEditingId(null), []);

  const deleteRow = useCallback((id: number) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // Patients without insurance are not shown or exported; they are only counted.
  const insuredRows = useMemo(() => rows.filter(hasInsurance), [rows]);

  const stats = useMemo(
    () => ({
      patients: insuredRows.length,
      matching: insuredRows.filter((r) => hasTargetCode(r.procedureCodes)).length,
      withoutInsurance: rows.length - insuredRows.length,
      byInsurance: patientsByInsurance(insuredRows),
    }),
    [rows, insuredRows],
  );

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return insuredRows;
    return insuredRows.filter(
      (r) =>
        r.patientName.toLowerCase().includes(q) ||
        r.procedureCodes.toLowerCase().includes(q) ||
        r.primaryInsurance.toLowerCase().includes(q) ||
        r.secondaryInsurance.toLowerCase().includes(q),
    );
  }, [insuredRows, search]);

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = visibleRows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const exportCsv = () => {
    const base = status.kind === "done" ? status.fileName.replace(/\.pdf$/i, "") : "treatment-plans";
    const csv = toCsv(
      ["Patient Name", "Procedure Code", "Insurance"],
      insuredRows.map((r) => [r.patientName, r.procedureCodes, insuranceLabel(r.primaryInsurance, r.secondaryInsurance)]),
    );
    downloadCsv(`${base}-extracted.csv`, csv);
  };

  const parsing = status.kind === "parsing";
  const hasRows = rows.length > 0;
  const percent = status.kind === "parsing" && status.total > 0 ? Math.round((status.page / status.total) * 100) : 0;

  return (
    <div className="workspace">
      <section className="card upload-card" aria-labelledby="upload-heading">
        <div
          className={`dropzone${dragging ? " dragging" : ""}${parsing ? " disabled" : ""}${hasRows ? " compact" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            if (!parsing) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file && !parsing) void handleFile(file);
          }}
        >
          <span className="dropzone-icon">
            <UploadIcon size={22} />
          </span>
          <div className="dropzone-text">
            <h2 id="upload-heading">
              {status.kind === "done" ? status.fileName : "Drop a treatment plan PDF here"}
            </h2>
            <p className="muted">
              {status.kind === "done"
                ? `${status.result.totalPages.toLocaleString()} pages read in ${status.seconds.toFixed(1)}s. Choose another PDF to replace the table.`
                : "Large files are fine. The PDF is read in your browser and never uploaded."}
            </p>
          </div>
          <button
            type="button"
            className="btn primary"
            disabled={parsing}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileIcon size={16} />
            Choose PDF
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFile(file);
            }}
          />
        </div>

        {status.kind === "parsing" && (
          <div className="progress-block" aria-live="polite">
            <div className="progress-head">
              <div className="progress-file">
                <FileIcon size={16} />
                <span className="truncate">{status.fileName}</span>
              </div>
              <span className="progress-count">
                {status.total > 0 ? (
                  <>
                    Page <strong>{status.page}</strong> of {status.total}
                  </>
                ) : (
                  "Opening file…"
                )}
              </span>
              <button type="button" className="btn subtle" onClick={() => abortRef.current?.abort()}>
                Cancel
              </button>
            </div>
            <div
              className="progress-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-label="Reading PDF"
            >
              <span style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}

        {status.kind === "error" && (
          <p className="alert" role="alert">
            <AlertIcon size={16} />
            {status.message}
          </p>
        )}

        {status.kind === "done" && status.result.pagesWithoutText.length > 0 && (
          <p className="alert warn">
            <AlertIcon size={16} />
            {`${status.result.pagesWithoutText.length} page(s) had no readable text (possibly scanned) and were skipped: ${status.result.pagesWithoutText.slice(0, 20).join(", ")}${status.result.pagesWithoutText.length > 20 ? "…" : ""}.`}
          </p>
        )}
      </section>

      {hasRows && (
        <section className="card table-card" aria-labelledby="table-heading">
          <div className="table-head">
            <h2 id="table-heading">Extracted data</h2>
            <div className="table-actions">
              <button type="button" className="btn primary" onClick={exportCsv} disabled={insuredRows.length === 0}>
                <DownloadIcon size={16} />
                Download CSV
              </button>
            </div>
          </div>

          <dl className="stat-row">
            <div className="stat-box">
              <dt>Total patients</dt>
              <dd>{stats.patients.toLocaleString()}</dd>
              <p>With insurance, shown in the table</p>
            </div>
            <div className="stat-box match">
              <dt>Matching procedure codes</dt>
              <dd>{stats.matching.toLocaleString()}</dd>
              <p className="code-legend">
                {TARGET_CODES.map((c) => (
                  <span key={c} className="code-chip">
                    {c}
                  </span>
                ))}
              </p>
            </div>
            <div className="stat-box muted-box">
              <dt>Without insurance</dt>
              <dd>{stats.withoutInsurance.toLocaleString()}</dd>
              <p>Not shown in the table</p>
            </div>
          </dl>

          {stats.byInsurance.length > 0 && (
            <ul className="insurance-list" aria-label="Patients by insurance">
              {stats.byInsurance.map(({ name, count }) => (
                <li key={name}>
                  <span className="insurance-name">{name}</span>
                  <span className="insurance-count">{count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="search">
            <SearchIcon size={16} />
            <input
              type="search"
              aria-label="Search rows"
              placeholder="Search name, code or insurance"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>

          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  <th scope="col">Patient Name</th>
                  <th scope="col">Procedure Code</th>
                  <th scope="col">Insurance</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) =>
                  row.id === editingId ? (
                    <EditRow key={row.id} row={row} onSave={saveRow} onCancel={cancelEdit} />
                  ) : (
                    <ViewRow
                      key={row.id}
                      row={row}
                      editDisabled={editingId !== null}
                      onEdit={setEditingId}
                      onDelete={deleteRow}
                    />
                  ),
                )}
                {pageRows.length === 0 && (
                  <tr className="empty-row">
                    <td colSpan={3}>No rows match your search.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <nav className="pager" aria-label="Table pages">
            <span className="muted">
              {visibleRows.length === 0
                ? "0 patients"
                : `${(currentPage * PAGE_SIZE + 1).toLocaleString()}–${Math.min((currentPage + 1) * PAGE_SIZE, visibleRows.length).toLocaleString()} of ${visibleRows.length.toLocaleString()} patients`}
            </span>
            <div className="pager-controls">
              <button
                type="button"
                className="btn icon"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
                aria-label="Previous page"
              >
                <ChevronIcon dir="left" size={16} />
              </button>
              <span className="pager-status">
                Page {currentPage + 1} of {pageCount}
              </span>
              <button
                type="button"
                className="btn icon"
                disabled={currentPage >= pageCount - 1}
                onClick={() => setPage(currentPage + 1)}
                aria-label="Next page"
              >
                <ChevronIcon size={16} />
              </button>
            </div>
          </nav>
        </section>
      )}
    </div>
  );
}

/** Comma-separated codes; any code from TARGET_CODES is highlighted. */
function CodeList({ codes }: { codes: string }) {
  const list = splitCodes(codes);
  if (list.length === 0) return <span className="codes">—</span>;
  return (
    <span className="codes">
      {list.map((code, i) => (
        <span key={i}>
          {isTargetCode(code) ? <mark className="code-hit">{code}</mark> : code}
          {i < list.length - 1 && ", "}
        </span>
      ))}
    </span>
  );
}

function InsuranceText({ primary, secondary }: { primary: string; secondary: string }) {
  if (!primary && !secondary) return <span className="ins-none">No insurance</span>;
  return (
    <div className="ins-text">
      {primary && <span>{primary}</span>}
      {secondary && <span>{secondary}</span>}
    </div>
  );
}

const ViewRow = memo(function ViewRow({
  row,
  editDisabled,
  onEdit,
  onDelete,
}: {
  row: Row;
  editDisabled: boolean;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <tr className={[row.warning && "flagged", hasTargetCode(row.procedureCodes) && "matched"].filter(Boolean).join(" ") || undefined}>
      <td data-label="Patient Name">
        <div className="name-cell">
          <span className="row-actions">
            <button
              type="button"
              className="icon-btn edit"
              onClick={() => onEdit(row.id)}
              disabled={editDisabled}
              aria-label={`Edit row for ${row.patientName || "new patient"}`}
            >
              <PencilIcon size={14} />
            </button>
            <button
              type="button"
              className="icon-btn delete"
              onClick={() => onDelete(row.id)}
              disabled={editDisabled}
              aria-label={`Delete row for ${row.patientName || "new patient"}`}
            >
              <CloseIcon size={14} />
            </button>
          </span>
          <div className="name-text">
            <span className="patient-name">{row.patientName || <span className="ins-none">—</span>}</span>
            {row.warning && (
              <span className="row-warning">
                <AlertIcon size={12} />
                {row.warning}
              </span>
            )}
          </div>
        </div>
      </td>
      <td data-label="Procedure Code" className="code-cell">
        <CodeList codes={row.procedureCodes} />
      </td>
      <td data-label="Insurance">
        <InsuranceText primary={row.primaryInsurance} secondary={row.secondaryInsurance} />
      </td>
    </tr>
  );
});

function EditRow({
  row,
  onSave,
  onCancel,
}: {
  row: Row;
  onSave: (id: number, procedureCodes: string) => void;
  onCancel: () => void;
}) {
  const [codes, setCodes] = useState(row.procedureCodes);
  const codesRef = useRef<HTMLTextAreaElement>(null);

  // Grow the box to fit every code instead of cutting long lists off.
  useEffect(() => {
    const el = codesRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [codes]);

  useEffect(() => {
    const el = codesRef.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Enter saves, Escape cancels.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSave(row.id, codes);
    }
    if (e.key === "Escape") onCancel();
  };

  return (
    <tr className={`editing${row.warning ? " flagged" : ""}`} onKeyDown={onKeyDown}>
      <td data-label="Patient Name">
        <div className="name-cell">
          <span className="row-actions visible">
            <button type="button" className="icon-btn save" onClick={() => onSave(row.id, codes)} aria-label="Save codes">
              <CheckIcon size={14} />
            </button>
            <button type="button" className="icon-btn cancel" onClick={onCancel} aria-label="Cancel editing">
              <CloseIcon size={14} />
            </button>
          </span>
          <span className="patient-name">{row.patientName}</span>
        </div>
      </td>
      <td data-label="Procedure Code" className="code-cell">
        <textarea
          ref={codesRef}
          className="edit-input code"
          rows={1}
          aria-label="Procedure codes, separated by commas"
          placeholder="D0120, D1110"
          value={codes}
          onChange={(e) => setCodes(e.target.value)}
        />
      </td>
      <td data-label="Insurance">
        <InsuranceText primary={row.primaryInsurance} secondary={row.secondaryInsurance} />
      </td>
    </tr>
  );
}
