// Smart Test Import — safe upload → preview → validate → fix → confirm → save.
// Replaces the old one-shot CSV import: parsed items are NEVER saved directly.
// The teacher sees an editable preview with per-item status + parsing
// confidence, fixes flagged issues inline, and can only save once no critical
// error remains. Parsing/validation lives in lib/test-import (pure + tested).

import { useMemo, useRef, useState } from "react";
import type { CognitiveLevel, Difficulty, ItemType, TestVersion, VersionKey } from "../lib/types";
import { COGNITIVE_LEVELS, DIFFICULTIES, ITEM_TYPES } from "../lib/types";
import { isObjective } from "../lib/items";
import {
  buildImport,
  importTest,
  revalidateRow,
  type ImportRow,
  type ImportStatus,
  type ImportSummary,
} from "../lib/test-import";
import { downloadCsv, toCsv } from "../lib/export";
import { extractImportFile } from "../lib/import-file";
import { Button } from "./ui";

const STATUS_META: Record<ImportStatus, { label: string; cls: string }> = {
  ready: { label: "Ready", cls: "bg-emerald-100 text-emerald-700" },
  review: { label: "Review", cls: "bg-amber-100 text-amber-800" },
  manual: { label: "Manual check", cls: "bg-violet-100 text-violet-700" },
  error: { label: "Needs fix", cls: "bg-red-100 text-red-700" },
};

export function TestImport({
  versions,
  hasItems,
  defaultOpen = false,
  onSave,
}: {
  versions: TestVersion[];
  hasItems: boolean;
  defaultOpen?: boolean;
  onSave: (
    items: ReturnType<typeof buildImport>["items"],
    keys: Partial<Record<TestVersion, VersionKey>>,
  ) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileMessage, setFileMessage] = useState("");
  const [readingFile, setReadingFile] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ctx = useMemo(() => ({ versions }), [versions]);

  // Parse raw text (from a file or the paste box) into preview rows. Never fails
  // silently: always sets summary + a human message, even when 0 items detected.
  function runParse(raw: string, notices: string[] = [], source = "paste") {
    const s = importTest(raw, ctx);
    if (notices.length) s.parseErrors = [...notices, ...s.parseErrors];
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[import] parsed", {
        source,
        rawLength: raw.length,
        detected: s.detected,
        ready: s.ready,
        review: s.review,
        manual: s.manual,
        errors: s.errors,
        parseErrors: s.parseErrors,
      });
    }
    // Nothing recognized and no error to show: stay on the upload screen with a
    // clear reason instead of flipping to an empty, misleading preview.
    if (s.detected === 0 && s.parseErrors.length === 0) {
      setSummary(null);
      setRows([]);
      setFileMessage(
        "No questions were detected. Check the column headers (Question, Type, Answer…) " +
          "or start from the downloadable template.",
      );
      return s;
    }
    setSummary(s);
    setRows(s.rows);
    return s;
  }

  async function handleImportFile(file: File, source = "file") {
    if (!file) return;
    setReadingFile(true);
    setFileMessage(`Reading ${file.name}...`);
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[import] file selected", {
        source,
        name: file.name,
        type: file.type,
        size: file.size,
      });
    }
    try {
      const extracted = await extractImportFile(file);
      setText(extracted.text);
      const s = runParse(extracted.text, extracted.notices, source);
      if (s.detected > 0) {
        setFileMessage(`Loaded ${file.name}. Review ${s.detected} detected item(s) before saving.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read this file.";
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug("[import] read/parse failed", { name: file.name, message });
      }
      setSummary({
        rows: [],
        versions,
        detected: 0,
        ready: 0,
        review: 0,
        manual: 0,
        errors: 0,
        scannable: 0,
        manualScoring: 0,
        rejected: 0,
        skippedNumbers: [],
        duplicateNumbers: [],
        parseErrors: [message],
        blocked: true,
      });
      setRows([]);
      setFileMessage(`Could not load ${file.name}. ${message}`);
    } finally {
      setReadingFile(false);
    }
  }

  // Open the standalone hidden picker scoped to a file type, so each button only
  // offers the formats it names ("Import from Excel" → .xlsx/.xls, etc.). The
  // input is NOT wrapped in a <label>, so a programmatic .click() can't bubble
  // to a label and get re-dispatched (which silently drops the change event).
  function openPicker(accept: string) {
    const input = fileRef.current;
    if (!input) return;
    input.accept = accept;
    input.value = ""; // allow re-picking the same file
    input.click();
  }

  // Per-format entry points. All formats flow through the one extract → parse →
  // preview path, so every source produces the same normalized rows + preview.
  const importExcel = () => openPicker(".xlsx,.xls");
  const importCsv = () => openPicker(".csv,.txt");
  const importWord = () => openPicker(".docx");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    try {
      if (file) await handleImportFile(file, "file");
    } finally {
      if (e.target) e.target.value = "";
    }
  }

  // Recompute a row + the blocking summary after an inline edit.
  function editRow(key: string, patch: Partial<ImportRow>) {
    setRows((prev) => {
      const next = prev.map((r) => {
        if (r.key !== key) return r;
        const merged = { ...r, ...patch };
        const others = prev.filter((o) => o.key !== key).map((o) => o.itemNumber);
        return revalidateRow(merged, ctx, others);
      });
      recomputeSummary(next);
      return next;
    });
  }

  function deleteRow(key: string) {
    setRows((prev) => {
      const next = prev.filter((r) => r.key !== key);
      recomputeSummary(next);
      return next;
    });
  }

  function recomputeSummary(next: ImportRow[]) {
    setSummary((s) =>
      s
        ? {
            ...s,
            rows: next,
            detected: next.length,
            ready: next.filter((r) => r.status === "ready").length,
            review: next.filter((r) => r.status === "review").length,
            manual: next.filter((r) => r.status === "manual").length,
            errors: next.filter((r) => r.status === "error").length,
            scannable: next.filter((r) => isObjective(r.type) && r.status !== "error").length,
            manualScoring: next.filter((r) => !isObjective(r.type) && r.status !== "error").length,
            rejected: next.filter((r) => r.status === "error").length,
            blocked: next.some((r) => r.issues.some((i) => i.level === "critical")),
          }
        : s,
    );
  }

  function confirmSave() {
    if (!summary || summary.blocked) return;
    if (
      hasItems &&
      !window.confirm(
        `Replace this assessment's existing items with ${rows.length} imported item(s)?`,
      )
    ) {
      return;
    }
    const built = buildImport("", rows, versions);
    // The itemNumber ordering is preserved; re-key items to the assessment id
    // happens in the parent (it owns the active id). Pass items + keys up.
    onSave(built.items, built.keys);
    reset();
  }

  function reset() {
    setSummary(null);
    setRows([]);
    setText("");
    setFileMessage("");
    setReadingFile(false);
    setOpen(false);
  }

  function downloadTemplate() {
    const answerCols = versions.map((v) => "answerVersion" + v);
    const headers = [
      "Item No.", "Type", "Question",
      "Choice A", "Choice B", "Choice C", "Choice D", "Choice E",
      "Correct Answer", ...answerCols,
      "Points", "Competency", "Difficulty", "Cognitive Level", "Explanation",
    ];
    // One sample per common type so teachers see the exact shape expected.
    const multipleChoice = [
      "1", "Multiple Choice", "What is a function?",
      "A relation where each input has one output", "A random set of numbers",
      "Any equation with x", "A straight line only", "",
      "A", ...versions.map(() => "A"),
      "1", "Represents real-life situations using functions",
      "Easy", "Understanding", "One output per input.",
    ];
    const trueFalse = [
      "2", "True or False", "A function can map one input to two outputs.",
      "", "", "", "", "",
      "False", ...versions.map(() => "False"),
      "1", "Understands the definition of a function",
      "Easy", "Understanding", "Each input has exactly one output.",
    ];
    const identification = [
      "3", "Identification", "The set of all first coordinates (x-values) of a relation.",
      "", "", "", "", "",
      "Domain", ...versions.map(() => ""),
      "1", "Identifies the parts of a relation",
      "Average", "Remembering", "Domain is the set of x-values.",
    ];
    downloadCsv(
      toCsv(headers, [multipleChoice, trueFalse, identification]),
      "daliguro_test_template.csv",
    );
  }

  if (!open) {
    return (
      <div className="mt-3">
        <Button variant="ghost" onClick={() => setOpen(true)}>
          ⬆ Smart Test Import
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold text-indigo-900">⬆ Smart Test Import</h2>
        <button className="text-xs font-bold text-indigo-700" onClick={reset}>close</button>
      </div>
      <p className="mt-1 text-xs text-indigo-900/80">
        Paste or upload teacher-made tests. DALIguro extracts what it can, shows exact
        item-level issues, and saves only after teacher review. Answer letters fill the
        answer key only, never the QR.
      </p>

      {!summary ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
            <ImportChoice title="Spreadsheet" label="Import from Excel" text="Upload an .xlsx workbook." onClick={importExcel} />
            <ImportChoice title="Fastest" label="Import from CSV" text="Upload a .csv or .txt file." onClick={importCsv} />
            <ImportChoice title="Document" label="Import from Word" text="Upload a .docx file." onClick={importWord} />
            <ImportChoice title="Convenient" label="Paste Test Text" text="Copy questions and paste below." onClick={() => document.getElementById("smart-import-paste")?.focus()} />
            <ImportChoice title="Template" label="Download Excel Template" text="Sample rows for MC, True/False, ID." onClick={downloadTemplate} />
          </div>
          {/* Drop zone is a plain button, NOT a <label> wrapping the input, so a
              programmatic .click() on the input can't be re-dispatched by a label
              (which silently swallowed the change event). */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => openPicker(".csv,.txt,.xlsx,.docx")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openPicker(".csv,.txt,.xlsx,.docx");
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void handleImportFile(file, "drop");
            }}
            className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-indigo-200 bg-white px-4 py-5 text-center text-sm font-bold text-indigo-900 transition hover:border-indigo-500 hover:bg-indigo-50"
          >
            <span>{readingFile ? "Reading file..." : "Choose or drop CSV, Excel .xlsx, Word .docx, or TXT"}</span>
            <span className="mt-1 text-xs font-semibold text-slate-500">
              DALIguro will open a preview table before anything is saved.
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            aria-label="Import test file"
            accept=".csv,.txt,.xlsx,.docx,.pdf,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            onChange={onFile}
          />
          {fileMessage ? (
            <div className="mt-2 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-indigo-800">
              {fileMessage}
            </div>
          ) : null}
          <div className="mt-3">
            <span className="mb-1 block text-xs font-bold text-slate-500">…or paste test text</span>
            <textarea
              id="smart-import-paste"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"1. What is a function?\nA. ...\nB. ...\nAnswer: A\nCompetency: ...\nDifficulty: Easy"}
              className="min-h-32 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
            />
            <div className="mt-2">
              <Button variant="small" onClick={() => text.trim() && runParse(text)}>Detect &amp; preview</Button>
            </div>
          </div>
        </>
      ) : (
        <PreviewTable
          summary={summary}
          rows={rows}
          versions={versions}
          onEdit={editRow}
          onDelete={deleteRow}
          onCancel={() => { setSummary(null); setRows([]); }}
          onConfirm={confirmSave}
        />
      )}
    </div>
  );
}

function PreviewTable({
  summary,
  rows,
  versions,
  onEdit,
  onDelete,
  onCancel,
  onConfirm,
}: {
  summary: ImportSummary;
  rows: ImportRow[];
  versions: TestVersion[];
  onEdit: (key: string, patch: Partial<ImportRow>) => void;
  onDelete: (key: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-3">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 text-xs font-bold">
        <span>{summary.detected} detected</span>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">{summary.ready} ready</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">{summary.review} review</span>
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-violet-700">{summary.manual} manual</span>
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">{summary.errors} to fix</span>
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700">{summary.scannable} scannable</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{summary.manualScoring} manual scoring</span>
        {summary.skippedNumbers.length > 0 ? (
          <span className="text-red-700">· skipped #{summary.skippedNumbers.join(", ")}</span>
        ) : null}
      </div>

      {summary.parseErrors.length > 0 ? (
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
          {summary.parseErrors.map((e) => <div key={e}>{e}</div>)}
        </div>
      ) : null}

      {summary.blocked ? (
        <div className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2 text-xs font-bold text-red-700">
          ⚠ Fix all “Needs fix” items (missing question, missing/invalid answer key, duplicate number)
          before saving. Nothing is saved until every critical issue is cleared.
        </div>
      ) : (
        <div className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2 text-xs font-bold text-emerald-800">
          ✓ No critical issues — ready to save {summary.detected} item(s).
        </div>
      )}

      <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 text-left text-slate-500">
          {["#", "Question", "Type", "Ch.", "Answer", "Pts", "Competency", "Diff.", "Cog.", "Status", "Conf.", "Action"].map((h) => (
                <th key={h} className="px-2 py-2 font-bold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <PreviewRow key={r.key} row={r} versions={versions} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={onConfirm} disabled={summary.blocked}>
          {summary.blocked ? "Fix issues to save" : `💾 Confirm & save ${summary.detected} item(s)`}
        </Button>
        <Button variant="ghost" onClick={onCancel}>Back</Button>
      </div>
    </div>
  );
}

function PreviewRow({
  row,
  versions,
  onEdit,
  onDelete,
}: {
  row: ImportRow;
  versions: TestVersion[];
  onEdit: (key: string, patch: Partial<ImportRow>) => void;
  onDelete: (key: string) => void;
}) {
  const st = STATUS_META[row.status];
  const objective = isObjective(row.type);
  const answerValue = objective
    ? (row.answers[versions[0] ?? "A"] ?? row.answers.A ?? "")
    : (row.correctAnswer || row.acceptedAnswers.join(", "));
  const crit = row.issues.some((i) => i.level === "critical");

  function setAnswer(v: string) {
    if (objective) {
      const letter = v.toUpperCase().trim();
      const answers: Partial<Record<TestVersion, string>> = {};
      (versions.length ? versions : (["A"] as TestVersion[])).forEach((ver) => {
        if (letter) answers[ver] = letter;
      });
      onEdit(row.key, { answers });
    } else {
      onEdit(row.key, { correctAnswer: v, acceptedAnswers: v.split(",").map((s) => s.trim()).filter(Boolean) });
    }
  }

  const rowBg = crit ? "bg-red-50" : row.status === "review" ? "bg-amber-50/40" : "";
  return (
    <tr className={"border-t border-slate-100 align-top " + rowBg} title={row.issues.map((i) => i.text).join("\n")}>
      <td className="px-2 py-1 font-bold">{row.itemNumber}</td>
      <td className="px-2 py-1">
        <textarea
          value={row.question}
          onChange={(e) => onEdit(row.key, { question: e.target.value })}
          className="min-h-8 w-44 rounded border border-slate-200 px-1.5 py-1"
        />
        {row.issues.length > 0 ? (
          <div className="mt-1 space-y-0.5">
            {row.issues.map((issue) => (
              <div
                key={issue.text}
                className={issue.level === "critical" ? "text-[10px] font-bold text-red-700" : "text-[10px] font-semibold text-amber-700"}
              >
                {issue.level === "critical" ? "Fix: " : "Review: "}
                {issue.text}
              </div>
            ))}
          </div>
        ) : null}
      </td>
      <td className="px-2 py-1">
        <select
          value={row.type}
          onChange={(e) => onEdit(row.key, { type: e.target.value as ItemType })}
          className="w-28 rounded border border-slate-200 px-1 py-1"
        >
          {ITEM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      <td className="px-2 py-1">
        {row.type === "Multiple Choice" || row.type === "Matching Type" ? (
          <select
            value={row.choices}
            onChange={(e) => onEdit(row.key, { choices: Number(e.target.value) })}
            className="w-12 rounded border border-slate-200 px-1 py-1"
          >
            {[2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        ) : <span className="text-slate-300">—</span>}
      </td>
      <td className="px-2 py-1">
        {row.manualCheck ? (
          <span className="text-slate-400">manual</span>
        ) : (
          <input
            value={answerValue}
            onChange={(e) => setAnswer(e.target.value)}
            className={"w-20 rounded border px-1.5 py-1 " + (crit && !answerValue ? "border-red-400" : "border-slate-200")}
          />
        )}
      </td>
      <td className="px-2 py-1">
        <input
          type="number" min={1} value={row.points}
          onChange={(e) => onEdit(row.key, { points: Math.max(1, Number(e.target.value) || 1) })}
          className="w-12 rounded border border-slate-200 px-1 py-1"
        />
      </td>
      <td className="px-2 py-1">
        <input
          value={row.competency}
          onChange={(e) => onEdit(row.key, { competency: e.target.value })}
          className="w-36 rounded border border-slate-200 px-1.5 py-1"
        />
      </td>
      <td className="px-2 py-1">
        <select
          value={row.difficulty}
          onChange={(e) => onEdit(row.key, { difficulty: e.target.value as Difficulty })}
          className="w-24 rounded border border-slate-200 px-1 py-1"
        >
          {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </td>
      <td className="px-2 py-1">
        <select
          value={row.cognitiveLevel}
          onChange={(e) => onEdit(row.key, { cognitiveLevel: e.target.value as CognitiveLevel | "" })}
          className="w-28 rounded border border-slate-200 px-1 py-1"
        >
          <option value="">—</option>
          {COGNITIVE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </td>
      <td className="px-2 py-1">
        <span className={"rounded px-1.5 py-0.5 font-bold " + st.cls}>{st.label}</span>
      </td>
      <td className="px-2 py-1 font-bold">{Math.round(row.confidence * 100)}%</td>
      <td className="px-2 py-1">
        <button
          type="button"
          onClick={() => onDelete(row.key)}
          className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-100"
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

function ImportChoice({
  title,
  label,
  text,
  onClick,
}: {
  title: string;
  label: string;
  text: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-indigo-100 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md"
    >
      <span className="block text-[10px] font-extrabold uppercase tracking-[0.12em] text-indigo-500">
        {title}
      </span>
      <span className="mt-1 block text-sm font-extrabold text-slate-950">{label}</span>
      <span className="mt-1 block text-xs font-semibold leading-relaxed text-slate-500">{text}</span>
    </button>
  );
}
