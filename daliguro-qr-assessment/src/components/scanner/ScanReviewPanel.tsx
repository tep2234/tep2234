// Phase 12 — review + correct an OMR scan before saving.
// Mobile: card-per-item layout. sm+: compact table.

import { useState } from "react";
import type { Item, Learner, TestVersion, VersionKey } from "../../lib/types";
import { masteryColor } from "../../lib/scoring";
import { CHOICES } from "../../lib/scanner/omr-template";
import type { ItemStatus } from "../../lib/scanner/omr-detect";
import type { CaptureProvenance } from "../../lib/scanner/still-pipeline";
import {
  REVIEW_CONFIDENCE,
  buildReview,
  type ReviewDecisions,
  type ReviewRow,
} from "../../lib/scanner/omr-score";
import { Button } from "../ui";

const STATUS_TONE: Record<ItemStatus, string> = {
  selected: "bg-emerald-100 text-emerald-700",
  blank: "bg-slate-100 text-slate-500",
  unclear: "bg-amber-100 text-amber-800",
  multiple: "bg-red-100 text-red-700",
  unreadable: "bg-red-100 text-red-700",
};

function confidenceBadge(conf: number): string {
  const pct = Math.round(conf * 100);
  if (pct >= 75) return "bg-emerald-100 text-emerald-700";
  if (pct >= 50) return "bg-amber-100 text-amber-800";
  return "bg-red-100 text-red-700";
}

export function ScanReviewPanel({
  learner,
  version,
  assessmentTitle,
  omrItems,
  versionKey,
  readings,
  alreadySaved,
  captureSource,
  onSave,
  onRescan,
}: {
  learner: Learner;
  version: TestVersion;
  assessmentTitle: string;
  omrItems: Item[];
  versionKey: VersionKey;
  readings: import("../../lib/scanner/omr-detect").ItemReading[];
  alreadySaved: boolean;
  captureSource?: CaptureProvenance;
  onSave: (
    learner: Learner,
    version: TestVersion,
    responses: Record<string, string>,
    decisions: ReviewDecisions,
  ) => void;
  onRescan: () => void;
}) {
  const ordered = omrItems.slice().sort((a, b) => a.itemNumber - b.itemNumber);
  const [corrections, setCorrections] = useState<ReviewDecisions>({});
  const summary = buildReview(ordered, versionKey, readings, corrections);

  function correct(itemNumber: number, value: string) {
    setCorrections((prev) => ({ ...prev, [itemNumber]: value }));
  }

  function save() {
    if (summary.needsReview) return;
    const responses: Record<string, string> = {};
    summary.rows.forEach((r) => {
      responses[r.item.id] = r.detected ?? "";
    });
    onSave(learner, version, responses, { ...corrections });
  }

  const color = masteryColor(summary.masteryStatus);

  return (
    <div className="mt-4 space-y-3">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-lg font-extrabold">{learner.fullName}</div>
            <div className="text-sm text-slate-500">
              LRN {learner.lrn || "—"} · {assessmentTitle} · Version {version}
            </div>
            {captureSource ? (
              <div className="mt-1 text-xs font-bold text-slate-500">
                Evidence source: {captureSource}
              </div>
            ) : null}
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
          {summary.unresolvedCount > 0 && (
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700">
              ⛔ {summary.unresolvedCount} unscored pending decision
            </span>
          )}
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700">
            ✓ {summary.correctCount} correct
          </span>
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700">
            ✗ {summary.wrongCount} wrong
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
            ␣ {summary.blankCount} blank
          </span>
          {summary.unclearCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">
              ? {summary.unclearCount} unclear
            </span>
          )}
          {summary.multipleCount > 0 && (
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700">
              ✗✗ {summary.multipleCount} multiple
            </span>
          )}
          {summary.unreadableCount > 0 && (
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700">
              ◉ {summary.unreadableCount} unreadable
            </span>
          )}
          {summary.lowConfidenceCount > 0 && (
            <span className="rounded-full bg-orange-100 px-2.5 py-1 text-orange-800">
              ◷ {summary.lowConfidenceCount} low confidence
            </span>
          )}
        </div>

        {summary.needsReview && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
            ⚠ Saving is blocked. Explicitly confirm or correct every unreadable, ambiguous, multiple,
            or low-confidence item. Unresolved visual evidence is not scored.
          </div>
        )}
        {alreadySaved && (
          <div className="mt-2 text-xs font-bold text-slate-500">
            A result already exists for this learner + version — saving will replace it.
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={save} disabled={summary.needsReview} aria-disabled={summary.needsReview}>
            {summary.needsReview ? "Resolve highlighted items to save" : "💾 Save reviewed result"}
          </Button>
          <Button variant="ghost" onClick={onRescan}>
            ↺ Scan again
          </Button>
        </div>
      </div>

      {/* Mobile: cards (hidden at sm+) */}
      <div className="space-y-2 sm:hidden">
        {summary.rows.map((row) => (
          <MobileCard key={row.item.id} row={row} onCorrect={(v) => correct(row.itemNumber, v)} />
        ))}
      </div>

      {/* Desktop: table (hidden below sm) */}
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 bg-white sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-xs text-slate-500">
              {["#", "Answer", "Key", "Status", "Conf.", "Bubble read", "Set answer"].map((h) => (
                <th key={h} className="px-3 py-2 font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <TableRow
                key={row.item.id}
                row={row}
                onCorrect={(v) => correct(row.itemNumber, v)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ChoiceButtons({
  row,
  onCorrect,
}: {
  row: ReviewRow;
  onCorrect: (value: string) => void;
}) {
  const valid = Math.max(2, Math.min(row.item.choices, 5));
  const effective = row.detected ?? row.suggested;
  return (
    <div className="flex flex-wrap gap-1">
      {CHOICES.slice(0, valid).map((c) => {
        const on = effective === c;
        const suggestedOnly = row.detected == null && row.suggested === c;
        return (
          <button
            key={c}
            onClick={() => onCorrect(c)}
            className={
              "h-8 w-8 rounded border text-xs font-bold " +
              (on && !suggestedOnly
                ? "border-indigo-700 bg-indigo-700 text-white"
                : suggestedOnly
                  ? "border-amber-500 bg-amber-100 text-amber-900"
                : "border-slate-200 bg-white text-slate-600")
            }
            title={suggestedOnly ? "Scanner suggestion. Tap to confirm." : undefined}
          >
            {c}
          </button>
        );
      })}
      <button
        onClick={() => onCorrect("")}
        className={
          "h-8 rounded border px-2 text-xs font-bold " +
          (row.detected === null && row.suggested === null
            ? "border-slate-400 bg-slate-200 text-slate-700"
            : "border-slate-200 bg-white text-slate-500")
        }
      >
        blank
      </button>
    </div>
  );
}

function MobileCard({ row, onCorrect }: { row: ReviewRow; onCorrect: (value: string) => void }) {
  const pct = Math.round(row.confidence * 100);
  const cardBg = row.needsReview ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white";

  return (
    <div className={"rounded-xl border p-3 " + cardBg}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-sm font-extrabold text-slate-700">
            {row.item.itemNumber}
          </span>
          <div>
            <span
              className={
                "text-base font-extrabold " +
                (row.isCorrect
                  ? "text-emerald-700"
                  : row.detected || row.suggested
                    ? "text-red-700"
                    : "text-slate-400")
              }
            >
              {row.detected ?? row.suggested ?? "—"}
            </span>
            {!row.resolved && row.suggested && row.detected === null ? (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-900">
                suggested
              </span>
            ) : null}
            {row.correctAnswer && (
              <span className="ml-2 text-xs text-slate-500">key: {row.correctAnswer}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <span className={"rounded px-2 py-0.5 text-xs font-bold " + STATUS_TONE[row.status]}>
            {row.status}
          </span>
          <span className={"rounded px-2 py-0.5 text-xs font-bold " + confidenceBadge(row.confidence)}>
            {pct}%
          </span>
        </div>
      </div>

      <div className="mt-2">
        <ChoiceButtons row={row} onCorrect={onCorrect} />
      </div>
      <UnreadableChoices row={row} />
      <BubbleStrength row={row} />
    </div>
  );
}

function TableRow({ row, onCorrect }: { row: ReviewRow; onCorrect: (value: string) => void }) {
  const pct = Math.round(row.confidence * 100);
  const rowBg = row.needsReview ? "bg-amber-50" : "";
  return (
    <tr className={"border-t border-slate-100 " + rowBg}>
      <td className="px-3 py-2 font-bold">{row.item.itemNumber}</td>
      <td className="px-3 py-2">
        <span
          className={
            row.isCorrect
              ? "font-bold text-emerald-700"
              : row.detected || row.suggested
                ? "font-bold text-red-700"
                : "text-slate-400"
          }
        >
          {row.detected ?? row.suggested ?? "—"}
        </span>
        {!row.resolved && row.suggested && row.detected === null ? (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-900">
            suggested
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2 font-semibold text-slate-600">{row.correctAnswer || "—"}</td>
      <td className="px-3 py-2">
        <span className={"rounded px-2 py-0.5 text-xs font-bold " + STATUS_TONE[row.status]}>
          {row.status}
        </span>
      </td>
      <td className="px-3 py-2">
        <span className={"rounded px-2 py-0.5 text-xs font-bold " + confidenceBadge(row.confidence)}>
          {pct}%
        </span>
        {row.status === "selected" && row.confidence < REVIEW_CONFIDENCE ? (
          <div className="mt-1 text-[10px] font-bold text-orange-700">confirm</div>
        ) : null}
      </td>
      <td className="px-3 py-2">
        <UnreadableChoices row={row} />
        <BubbleStrength row={row} compact />
      </td>
      <td className="px-3 py-2">
        <ChoiceButtons row={row} onCorrect={onCorrect} />
      </td>
    </tr>
  );
}

function BubbleStrength({ row, compact = false }: { row: ReviewRow; compact?: boolean }) {
  const valid = Math.max(2, Math.min(row.item.choices, 5));
  return (
    <div className={compact ? "grid min-w-32 gap-1" : "mt-3 grid gap-1"}>
      {CHOICES.slice(0, valid).map((c, idx) => {
        const value = Math.max(0, Math.min(1, row.fill[idx] ?? 0));
        const active = row.suggested === c || row.detected === c;
        const unreadable = row.unreadableChoices.includes(idx);
        return (
          <div key={c} className="grid grid-cols-[1rem,1fr,2.5rem] items-center gap-1 text-[10px] font-bold text-slate-500">
            <span className={unreadable ? "text-red-700" : active ? "text-indigo-700" : ""}>{c}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-slate-200">
              <span
                className={(unreadable ? "bg-red-500" : active ? "bg-indigo-600" : "bg-slate-400") + " block h-full rounded-full"}
                style={{ width: `${Math.round(value * 100)}%` }}
              />
            </span>
            <span className="text-right">{Math.round(value * 100)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function UnreadableChoices({ row }: { row: ReviewRow }) {
  if (row.unreadableChoices.length === 0) return null;
  const labels = row.unreadableChoices.map((index) => CHOICES[index] ?? `#${index + 1}`);
  return (
    <div className="mt-1 text-[10px] font-extrabold text-red-700" role="alert">
      Unreadable visual evidence at choice{labels.length === 1 ? "" : "s"} {labels.join(", ")}. Confirm an answer or explicit blank.
    </div>
  );
}
