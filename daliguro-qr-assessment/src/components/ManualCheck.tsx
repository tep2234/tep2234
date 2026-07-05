// Manual (fallback) checking form — extracted from CheckPanel so the
// SmartScan pipeline and the hand-marking UI live in separate files.
// Reads assessment/items/keys/learner; writes only results.

import { useState } from "react";
import type { PanelProps } from "./panel-types";
import type {
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
import { uid } from "../lib/ids";
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
  alreadySaved: boolean;
  dirty: boolean;
  onDirty: (value: boolean) => void;
  setState: PanelProps["setState"];
}) {
  const [input, setInput] = useState<CheckingInput>(() => initialInput);
  const summary = computeScores(items, versionKey, input);

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
    const answers = items.map((i) => ({
      itemId: i.id,
      response: input.responses[i.id] ?? "",
    }));
    const now = Date.now();
    setState((prev) => {
      const existing = findResult(prev.results, active.id, learner.id, version);
      if (existing?.finalizedAt) {
        const reason = window.prompt(
          "This result is FINALIZED (locked). Enter a reason to change it, or Cancel:",
        );
        if (!reason || !reason.trim()) return prev;
        const result: Result = {
          ...existing,
          answers,
          itemScores: summary.itemScores,
          rawScore: summary.rawScore,
          totalScore: summary.totalScore,
          percentage: summary.percentage,
          masteryStatus: summary.masteryStatus,
          source: "manual",
          reviewStatus: "finalized",
          auditLog: existing.auditLog.concat({
            at: now,
            action: "Edited after finalization",
            reason: reason.trim(),
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
        source: "manual",
        scanConfidence: null,
        reviewStatus: "reviewed",
        finalizedAt: null,
        scanItems: null,
        auditLog: (existing ? existing.auditLog : []).concat({
          at: now,
          action: existing ? "Manually re-checked" : "Manually checked",
        }),
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
      };
      const results = existing
        ? prev.results.map((r) => (r.id === existing.id ? result : r))
        : prev.results.concat(result);
      return { ...prev, results };
    });
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
        <Button onClick={save}>💾 Save Score</Button>
      </div>

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
