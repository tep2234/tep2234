// Manual (fallback) checking form — extracted from CheckPanel so the
// SmartScan pipeline and the hand-marking UI live in separate files.
// Reads assessment/items/keys/learner; writes only results.

import { useState } from "react";
import type { PanelProps } from "./panel-types";
import type {
  AuditEntry,
  Assessment,
  Item,
  Learner,
  Result,
  TestVersion,
  VersionKey,
} from "../lib/types";
import { isManual, normalizeText, optionSet, usesAcceptedAnswers } from "../lib/items";
import {
  computeScores,
  emptyInput,
  masteryColor,
  type CheckingInput,
  type ScoreSummary,
} from "../lib/scoring";
import { uid, uuidV4 } from "../lib/ids";
import { manualFallbackBlocked } from "../lib/result-trust";
import { omrItemsOf } from "../lib/scanner/omr-template";
import {
  enqueueCompletedReview,
  flushReviewAuditOutbox,
} from "../lib/sync/review-audit-outbox";
import type { RemoteReviewDecision } from "../lib/sync/smartscanSync";
import { Button } from "./ui";

function findResult(
  results: Result[],
  assessmentId: string,
  learnerId: string,
  version: TestVersion,
): Result | undefined {
  return results.find(
    (r) =>
      r.assessmentId === assessmentId &&
      r.learnerId === learnerId &&
      r.version === version,
  );
}

export function CheckForm({
  active,
  items,
  versionKey,
  learner,
  version,
  initialInput,
  existingResult,
  alreadySaved,
  dirty,
  onDirty,
  setState,
}: {
  active: Assessment;
  items: Item[];
  versionKey: VersionKey;
  learner: Learner;
  version: TestVersion;
  initialInput: CheckingInput;
  existingResult?: Result;
  alreadySaved: boolean;
  dirty: boolean;
  onDirty: (value: boolean) => void;
  setState: PanelProps["setState"];
}) {
  const [input, setInput] = useState<CheckingInput>(() => initialInput);
  const summary = computeScores(items, versionKey, input);
  const blockedByScanReview = manualFallbackBlocked(existingResult);

  function mutate(next: CheckingInput) {
    setInput(next);
    onDirty(true);
  }
  function setResponse(itemId: string, value: string) {
    mutate({ ...input, responses: { ...input.responses, [itemId]: value } });
  }
  function setManual(itemId: string, value: number) {
    mutate({ ...input, manualScores: { ...input.manualScores, [itemId]: value } });
  }
  function setOverride(itemId: string, value: string) {
    const overrides = { ...input.overrides };
    if (value.trim() === "") delete overrides[itemId];
    else overrides[itemId] = Number(value);
    mutate({ ...input, overrides });
  }
  function setRemark(itemId: string, value: string) {
    mutate({ ...input, remarks: { ...input.remarks, [itemId]: value } });
  }
  function clearItem(itemId: string) {
    const responses = { ...input.responses };
    delete responses[itemId];
    mutate({ ...input, responses });
  }
  function resetAll() {
    if (!window.confirm("Reset all answers for this learner?")) return;
    mutate(emptyInput());
  }

  function save() {
    if (blockedByScanReview) {
      window.alert(
        "This scan contains unreadable or uncertain camera evidence. Resolve every highlighted item in the Review Queue before using manual fallback.",
      );
      return;
    }
    const changedItems = existingResult
      ? items.filter((item) => {
          const original = existingResult.answers.find((answer) => answer.itemId === item.id)?.response ?? "";
          const originalScore = existingResult.itemScores.find((score) => score.itemId === item.id)?.awarded ?? 0;
          const nextScore = summary.itemScores.find((score) => score.itemId === item.id)?.awarded ?? 0;
          return original !== (input.responses[item.id] ?? "") || originalScore !== nextScore;
        })
      : [];
    let editReason: string | undefined;
    if (existingResult && (existingResult.finalizedAt || changedItems.length > 0)) {
      const prompt = existingResult.finalizedAt
        ? "This result is FINALIZED (locked). Enter a reason to change it, or Cancel:"
        : "Enter a reason for changing this saved answer, or Cancel:";
      const reason = window.prompt(prompt);
      if (!reason || !reason.trim()) return;
      editReason = reason.trim();
    }
    const answers = items.map((i) => ({
      itemId: i.id,
      response: input.responses[i.id] ?? "",
    }));
    const now = Date.now();
    const omrItems = omrItemsOf(items);
    const omrRowByItemId = new Map(omrItems.map((item, index) => [item.id, index + 1]));
    const correctionEventIds = new Map(changedItems.map((item) => [item.id, uuidV4()]));
    const remoteDecisions: RemoteReviewDecision[] = existingResult?.sourceScanId
      ? changedItems.flatMap((item) => {
          const rowNumber = omrRowByItemId.get(item.id);
          if (rowNumber == null) return [];
          const originalAudit = existingResult.auditLog.find(
            (entry) => entry.itemId === item.id && entry.originalStatus !== undefined,
          );
          const scanItem = (existingResult.scanItems ?? []).find(
            (candidate) => candidate.itemNumber === rowNumber,
          );
          const originalStatus = originalAudit?.originalStatus ?? scanItem?.status;
          if (!originalStatus) return [];
          return [{
            eventId: correctionEventIds.get(item.id) ?? uuidV4(),
            omrRowNumber: rowNumber,
            itemId: item.id,
            itemNumber: item.itemNumber,
            originalStatus,
            originalValue:
              originalAudit?.originalValue ??
              scanItem?.detected ??
              existingResult.answers.find((answer) => answer.itemId === item.id)?.response ??
              "",
            correctedValue: input.responses[item.id] ?? "",
            source: "manual_check" as const,
            reason: editReason ?? "Teacher corrected an OMR answer during manual completion.",
          }];
        })
      : [];
    setState((prev) => {
      const existing = findResult(prev.results, active.id, learner.id, version);
      if (manualFallbackBlocked(existing)) return prev;
      const actorId = active.teacherName || "local-teacher";
      const scanId = existing ? existing.sourceScanId ?? existing.id : null;
      const answerAudits: AuditEntry[] = existing
        ? changedItems.map((item) => {
            const rowNumber = omrRowByItemId.get(item.id);
            const scanItem = rowNumber == null
              ? undefined
              : (existing.scanItems ?? []).find((candidate) => candidate.itemNumber === rowNumber);
            return {
              eventId: correctionEventIds.get(item.id) ?? uuidV4(),
              at: now,
              action: "Answer manually corrected",
              reason: editReason ?? "Teacher corrected a saved answer through manual fallback.",
              itemId: item.id,
              itemNumber: item.itemNumber,
              originalStatus: scanItem?.status,
              originalValue:
                isManual(item.type)
                  ? String(existing.itemScores.find((score) => score.itemId === item.id)?.awarded ?? 0)
                  : scanItem?.detected ??
                    existing.answers.find((answer) => answer.itemId === item.id)?.response ??
                    "",
              correctedValue: isManual(item.type)
                ? String(summary.itemScores.find((score) => score.itemId === item.id)?.awarded ?? 0)
                : input.responses[item.id] ?? "",
              actorId,
              source: "manual_check" as const,
              scanId,
            };
          })
        : [];
      const changedByRow = new Map(
        changedItems.flatMap((item) => {
          const rowNumber = omrRowByItemId.get(item.id);
          return rowNumber == null ? [] : [[rowNumber, input.responses[item.id] ?? ""] as const];
        }),
      );
      const updatedScanItems = existing?.scanItems?.map((scanItem) => {
        if (!changedByRow.has(scanItem.itemNumber)) return scanItem;
        const correctedValue = changedByRow.get(scanItem.itemNumber) ?? "";
        return {
          ...scanItem,
          detected: correctedValue || null,
          status: correctedValue ? "selected" as const : "blank" as const,
          confidence: 1,
          unreadableChoices: [],
        };
      }) ?? null;
      if (existing?.finalizedAt) {
        const result: Result = {
          ...existing,
          answers,
          itemScores: summary.itemScores,
          rawScore: summary.rawScore,
          totalScore: summary.totalScore,
          percentage: summary.percentage,
          masteryStatus: summary.masteryStatus,
          source: existing.source,
          reviewStatus: "finalized",
          scanItems: updatedScanItems,
          auditLog: existing.auditLog.concat(answerAudits, {
            at: now,
            action: "Edited after finalization",
            reason: editReason,
            actorId,
            source: "manual_check" as const,
            scanId,
          }),
          updatedAt: now,
        };
        return { ...prev, results: prev.results.map((r) => (r.id === existing.id ? result : r)) };
      }
      const result: Result = {
        id: existing ? existing.id : uid("R_"),
        assessmentId: active.id,
        learnerId: learner.id,
        version,
        answers,
        itemScores: summary.itemScores,
        rawScore: summary.rawScore,
        totalScore: summary.totalScore,
        percentage: summary.percentage,
        masteryStatus: summary.masteryStatus,
        reviewed: true,
        source: existing?.source ?? "manual",
        scanConfidence: existing?.scanConfidence ?? null,
        scanQuality: existing?.scanQuality ?? null,
        reviewStatus: "reviewed",
        finalizedAt: null,
        scanItems: updatedScanItems,
        sourceScanId: existing?.sourceScanId,
        sourceScanFingerprint: existing?.sourceScanFingerprint,
        auditLog: (existing ? existing.auditLog : []).concat(answerAudits, {
          at: now,
          action: existing ? "Manually re-checked" : "Manually checked",
          ...(editReason ? { reason: editReason } : {}),
          actorId,
          source: "manual_check" as const,
          scanId,
        }),
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
      };
      const results = existing
        ? prev.results.map((r) => (r.id === existing.id ? result : r))
        : prev.results.concat(result);
      return { ...prev, results };
    });
    if (
      existingResult?.sourceScanId &&
      existingResult.sourceScanFingerprint &&
      existingResult.reviewStatus === "needs_review"
    ) {
      enqueueCompletedReview(existingResult.sourceScanId, remoteDecisions, {
        eventId: uuidV4(),
        decision: "reviewed",
        reason: "Teacher completed the remaining manual-scoring items after camera review.",
      });
      void flushReviewAuditOutbox();
    }
    onDirty(false);
    window.alert(
      "Saved: " +
        summary.rawScore +
        "/" +
        summary.totalScore +
        " (" +
        summary.percentage +
        "%)",
    );
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="smallDanger" onClick={resetAll}>
          Reset all answers
        </Button>
        <Button onClick={save} disabled={blockedByScanReview} aria-disabled={blockedByScanReview}>
          {blockedByScanReview ? "Resolve scan in Review Queue" : "💾 Save Score"}
        </Button>
      </div>

      {blockedByScanReview ? (
        <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-sm font-bold text-red-800" role="alert">
          Manual fallback cannot replace unreadable scan evidence. Open the Review Queue and explicitly resolve each affected item first.
        </div>
      ) : null}

      <SummaryCard summary={summary} dirty={dirty} saved={alreadySaved} />

      <div className="mt-3 grid gap-2">
        {items.map((item) => (
          <CheckRow
            key={item.id}
            item={item}
            keyAnswer={versionKey[item.id] ?? ""}
            input={input}
            onResponse={(v) => setResponse(item.id, v)}
            onManual={(v) => setManual(item.id, v)}
            onOverride={(v) => setOverride(item.id, v)}
            onRemark={(v) => setRemark(item.id, v)}
            onClear={() => clearItem(item.id)}
          />
        ))}
      </div>
    </>
  );
}

function SummaryCard({
  summary,
  dirty,
  saved,
}: {
  summary: ScoreSummary;
  dirty: boolean;
  saved: boolean;
}) {
  const color = masteryColor(summary.masteryStatus);
  const stats: [string, string | number][] = [
    ["Raw", summary.rawScore + " / " + summary.totalScore],
    ["Percent", summary.percentage + "%"],
    ["Correct", summary.correctCount],
    ["Incorrect", summary.incorrectCount],
    ["Blank", summary.blankCount],
  ];
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        {stats.map(([label, value]) => (
          <div key={label} className="min-w-20">
            <div className="text-xl font-extrabold text-indigo-700">{value}</div>
            <div className="text-xs font-semibold text-slate-500">{label}</div>
          </div>
        ))}
        <div className="ml-auto text-right">
          <div className="text-sm font-extrabold" style={{ color }}>
            ● {summary.masteryStatus}
          </div>
          {saved ? (
            <div className="text-xs text-slate-500">existing result</div>
          ) : null}
          {dirty ? (
            <div className="text-xs font-bold text-amber-600">unsaved changes</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CheckRow({
  item,
  keyAnswer,
  input,
  onResponse,
  onManual,
  onOverride,
  onRemark,
  onClear,
}: {
  item: Item;
  keyAnswer: string;
  input: CheckingInput;
  onResponse: (value: string) => void;
  onManual: (value: number) => void;
  onOverride: (value: string) => void;
  onRemark: (value: string) => void;
  onClear: () => void;
}) {
  const response = input.responses[item.id] ?? "";
  const options = optionSet(item);
  const manual = isManual(item.type);
  const blank = response.trim() === "";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-indigo-700 px-1 text-sm font-bold text-white">
          {item.itemNumber}
        </span>
        <span className="text-sm text-slate-600">{item.type}</span>
        <span className="text-xs text-slate-400">({item.points} pt)</span>
        {!manual && blank ? (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
            blank
          </span>
        ) : null}
        {manual ? (
          <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-700">
            manual
          </span>
        ) : null}
        <button
          className="ml-auto text-xs font-bold text-slate-400 hover:text-red-600"
          onClick={onClear}
        >
          clear
        </button>
      </div>

      {item.question ? (
        <div className="mt-1 text-xs text-slate-500">{item.question}</div>
      ) : null}

      {/* Objective with fixed options */}
      {options ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {options.map((opt) => {
            const on = response === opt;
            const cls = on
              ? "border-indigo-700 bg-indigo-700 text-white"
              : "border-slate-200 bg-white text-slate-700";
            return (
              <button
                key={opt}
                onClick={() => onResponse(on ? "" : opt)}
                className={"h-10 w-10 rounded-lg border text-base font-bold " + cls}
              >
                {opt}
              </button>
            );
          })}
          <Verdict response={response} keyAnswer={keyAnswer} />
          <OverrideField item={item} input={input} onOverride={onOverride} />
        </div>
      ) : null}

      {/* Auto-scored free text (Sequencing / Identification / Fill / Short) */}
      {!options && !manual ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={response}
            onChange={(e) => onResponse(e.target.value)}
            placeholder="Learner answer"
            className="min-w-52 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <TextVerdict item={item} keyAnswer={keyAnswer} response={response} />
          <OverrideField item={item} input={input} onOverride={onOverride} />
        </div>
      ) : null}

      {/* Manual scoring (Problem Solving / Essay / Performance / Oral) */}
      {manual ? (
        <div className="mt-2 grid gap-2">
          {item.type === "Problem Solving" ? (
            <input
              value={response}
              onChange={(e) => onResponse(e.target.value)}
              placeholder="Final answer (optional)"
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-500">Score</span>
            <input
              type="number"
              min={0}
              max={item.points}
              value={
                input.manualScores[item.id] === undefined
                  ? ""
                  : input.manualScores[item.id]
              }
              placeholder="0"
              onChange={(e) => onManual(Number(e.target.value) || 0)}
              className="w-20 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <span className="text-xs text-slate-500">/ {item.points}</span>
            <input
              value={input.remarks[item.id] ?? ""}
              onChange={(e) => onRemark(e.target.value)}
              placeholder="Remarks (optional)"
              className="min-w-40 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Verdict({ response, keyAnswer }: { response: string; keyAnswer: string }) {
  if (response === "" || keyAnswer === "") return null;
  const good = response.toUpperCase() === keyAnswer.toUpperCase();
  const cls = good ? "text-emerald-600" : "text-red-600";
  return (
    <span className={"text-sm font-bold " + cls}>
      {good ? "✓" : "✗ key: " + keyAnswer}
    </span>
  );
}

// Uses the SAME normalizeText as the scorer, so the on-screen ✓/✗ always
// agrees with the computed score (including internal-whitespace tolerance).
function isTextMatch(item: Item, keyAnswer: string, response: string): boolean {
  if (usesAcceptedAnswers(item.type)) {
    const accepted = item.acceptedAnswers.map(normalizeText);
    if (item.correctAnswer.trim()) accepted.push(normalizeText(item.correctAnswer));
    return accepted.includes(normalizeText(response));
  }
  return keyAnswer.trim() !== "" && normalizeText(response) === normalizeText(keyAnswer);
}

function TextVerdict({
  item,
  keyAnswer,
  response,
}: {
  item: Item;
  keyAnswer: string;
  response: string;
}) {
  if (response.trim() === "") return null;
  const good = isTextMatch(item, keyAnswer, response);
  const cls = good ? "text-emerald-600" : "text-red-600";
  return <span className={"text-sm font-bold " + cls}>{good ? "✓" : "✗"}</span>;
}

function OverrideField({
  item,
  input,
  onOverride,
}: {
  item: Item;
  input: CheckingInput;
  onOverride: (value: string) => void;
}) {
  const value = Object.prototype.hasOwnProperty.call(input.overrides, item.id)
    ? String(input.overrides[item.id])
    : "";
  return (
    <label className="flex items-center gap-1 text-xs text-slate-500">
      override
      <input
        type="number"
        min={0}
        max={item.points}
        value={value}
        placeholder="—"
        onChange={(e) => onOverride(e.target.value)}
        className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-sm"
      />
    </label>
  );
}
