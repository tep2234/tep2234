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
  onSave,
}: {
  versions: TestVersion[];
  hasItems: boolean;
  onSave: (
    items: ReturnType<typeof buildImport>["items"],
    keys: Partial<Record<TestVersion, VersionKey>>,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const ctx = useMemo(() => ({ versions }), [versions]);

  function runParse(raw: string) {
    const s = importTest(raw, ctx);
    setSummary(s);
    setRows(s.rows);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((t) => {
      setText(t);
      runParse(t);
    });
    e.target.value = "";
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
    setOpen(false);
  }

  function downloadTemplate() {
    const answerCols = versions.map((v) => "answerVersion" + v);
    const headers = [
      "Item No.", "Item Type", "Question",
      "Choice A", "Choice B", "Choice C", "Choice D", "Choice E",
      "Correct Answer", ...answerCols,
      "Points", "Competency", "Topic", "Difficulty", "Cognitive Level",
      "Answer Explanation", "Manual Check Required",
    ];
    const example = [
      "1", "Multiple Choice", "What is a function?",
      "A relation where each input has one output", "A random set of numbers",
      "Any equation with x", "A straight line only", "",
      "A", ...versions.map(() => "A"),
      "1", "Represents real-life situations using functions", "Functions",
      "Easy", "Understanding", "One output per input.", "No",
    ];
    downloadCsv(toCsv(headers, [example]), "daliguro_test_template.csv");
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
        Upload a CSV / Excel-saved CSV, or paste a questionnaire (Word-style numbered
        items work too). Items are <b>previewed and validated first</b> — nothing is
        saved until you confirm. Answer letters fill the per-version key only, never a QR.
      </p>

      {!summary ? (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="small" onClick={() => fileRef.current?.click()}>Choose file (CSV)</Button>
            <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden onChange={onFile} />
            <Button variant="small" onClick={downloadTemplate}>⬇ Download template</Button>
          </div>
          <div className="mt-3">
            <span className="mb-1 block text-xs font-bold text-slate-500">…or paste test text</span>
            <textarea
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
  onCancel,
  onConfirm,
}: {
  summary: ImportSummary;
  rows: ImportRow[];
  versions: TestVersion[];
  onEdit: (key: string, patch: Partial<ImportRow>) => void;
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
              {["#", "Question", "Type", "Ch.", "Answer", "Pts", "Competency", "Diff.", "Cog.", "Status", "Conf."].map((h) => (
                <th key={h} className="px-2 py-2 font-bold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <PreviewRow key={r.key} row={r} versions={versions} onEdit={onEdit} />
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
}: {
  row: ImportRow;
  versions: TestVersion[];
  onEdit: (key: string, patch: Partial<ImportRow>) => void;
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
    </tr>
  );
}
