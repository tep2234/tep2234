// Phase 12 — review + correct an OMR scan before saving.
// Recomputes the score live as the teacher fixes unclear/multiple items.

import { useState } from "react";
import type { Item, Learner, TestVersion, VersionKey } from "../../lib/types";
import { masteryColor } from "../../lib/scoring";
import { CHOICES } from "../../lib/scanner/omr-template";
import type { ItemReading, ItemStatus } from "../../lib/scanner/omr-detect";
import { buildReview, type ReviewRow } from "../../lib/scanner/omr-score";
import { Button } from "../ui";

const STATUS_TONE: Record<ItemStatus, string> = {
  selected: "bg-emerald-100 text-emerald-700",
  blank: "bg-slate-100 text-slate-500",
  unclear: "bg-amber-100 text-amber-800",
  multiple: "bg-red-100 text-red-700",
};

export function ScanReviewPanel({
  learner,
  version,
  assessmentTitle,
  omrItems,
  versionKey,
  readings,
  alreadySaved,
  onSave,
  onRescan,
}: {
  learner: Learner;
  version: TestVersion;
  assessmentTitle: string;
  omrItems: Item[];
  versionKey: VersionKey;
  readings: ItemReading[];
  alreadySaved: boolean;
  onSave: (learner: Learner, version: TestVersion, responses: Record<string, string>) => void;
  onRescan: () => void;
}) {
  const ordered = omrItems.slice().sort((a, b) => a.itemNumber - b.itemNumber);
  const [corrections, setCorrections] = useState<Record<number, string>>({});
  const summary = buildReview(ordered, versionKey, readings, corrections);

  function correct(itemNumber: number, value: string) {
    setCorrections((prev) => ({ ...prev, [itemNumber]: value }));
  }

  function save() {
    if (
      summary.needsReview &&
      !window.confirm(
        "Some items are still unclear or have multiple marks. Save anyway? You can fix them first.",
      )
    ) {
      return;
    }
    const responses: Record<string, string> = {};
    summary.rows.forEach((r) => {
      responses[r.item.id] = r.detected ?? "";
    });
    onSave(learner, version, responses);
  }

  const color = masteryColor(summary.masteryStatus);

  return (
    <div className="mt-4">
      {/* Header card */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-extrabold">{learner.fullName}</div>
            <div className="text-sm text-slate-500">
              LRN {learner.lrn || "—"} · {assessmentTitle} · Version {version}
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-extrabold text-indigo-700">
              {summary.rawScore}/{summary.totalScore}
            </div>
            <div className="text-sm font-bold" style={{ color }}>
              {summary.percentage}% · {summary.masteryStatus}
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700">✓ {summary.correctCount} correct</span>
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700">✗ {summary.wrongCount} wrong</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">␣ {summary.blankCount} blank</span>
          {summary.unclearCount > 0 ? (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">? {summary.unclearCount} unclear</span>
          ) : null}
          {summary.multipleCount > 0 ? (
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700">✗✗ {summary.multipleCount} multiple</span>
          ) : null}
        </div>
        {summary.needsReview ? (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
            ⚠ Some items are unclear or have multiple marks. Set the correct
            answer below (or leave blank) before saving.
          </div>
        ) : null}
        {alreadySaved ? (
          <div className="mt-2 text-xs font-bold text-slate-500">
            A result already exists for this learner + version — saving will replace it.
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={save}>💾 Save result</Button>
          <Button variant="ghost" onClick={onRescan}>↺ Scan again</Button>
        </div>
      </div>

      {/* Item-by-item table */}
      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs text-slate-500">
              {["#", "Detected", "Key", "Status", "Conf.", "Set answer"].map((h) => (
                <th key={h} className="px-3 py-2 font-bold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <ReviewRowView key={row.item.id} row={row} onCorrect={(v) => correct(row.itemNumber, v)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReviewRowView({ row, onCorrect }: { row: ReviewRow; onCorrect: (value: string) => void }) {
  const valid = Math.max(2, Math.min(row.item.choices, 4));
  const rowBg = row.isCorrect
    ? ""
    : row.status === "multiple" || row.status === "unclear"
      ? "bg-amber-50"
      : "";
  return (
    <tr className={"border-t border-slate-100 " + rowBg}>
      <td className="px-3 py-2 font-bold">{row.item.itemNumber}</td>
      <td className="px-3 py-2">
        <span className={row.isCorrect ? "font-bold text-emerald-700" : row.detected ? "font-bold text-red-700" : "text-slate-400"}>
          {row.detected ?? "—"}
        </span>
      </td>
      <td className="px-3 py-2 font-semibold text-slate-600">{row.correctAnswer || "—"}</td>
      <td className="px-3 py-2">
        <span className={"rounded px-2 py-0.5 text-xs font-bold " + STATUS_TONE[row.status]}>{row.status}</span>
      </td>
      <td className="px-3 py-2 text-xs text-slate-500">{Math.round(row.confidence * 100)}%</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {CHOICES.slice(0, valid).map((c) => {
            const on = row.detected === c;
            return (
              <button
                key={c}
                onClick={() => onCorrect(c)}
                className={
                  "h-7 w-7 rounded border text-xs font-bold " +
                  (on ? "border-indigo-700 bg-indigo-700 text-white" : "border-slate-200 bg-white text-slate-600")
                }
              >
                {c}
              </button>
            );
          })}
          <button
            onClick={() => onCorrect("")}
            className={
              "h-7 rounded border px-2 text-xs font-bold " +
              (row.detected === null ? "border-slate-400 bg-slate-200 text-slate-700" : "border-slate-200 bg-white text-slate-500")
            }
          >
            blank
          </button>
        </div>
      </td>
    </tr>
  );
}
