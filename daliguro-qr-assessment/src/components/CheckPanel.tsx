// Phase 8 — Assisted Checking & Scoring.
// Reads assessment/items/keys/learners; writes only results.

import { useState } from "react";
import type { PanelProps } from "./panel-types";
import type {
  Assessment,
  Item,
  Learner,
  QrAssessmentState,
  Result,
  TestVersion,
  VersionKey,
} from "../lib/types";
import {
  acceptedMatch,
  isManual,
  isObjective,
  optionPairs,
  optionSet,
  usesAcceptedAnswers,
} from "../lib/items";
import {
  computeScores,
  emptyInput,
  masteryColor,
  type CheckingInput,
  type ScoreSummary,
} from "../lib/scoring";
import { uid } from "../lib/ids";
import { ActiveGate } from "./ActiveGate";
import { ScannerPlaceholder } from "./ScannerPlaceholder";
import { Button, Empty } from "./ui";

export default function CheckPanel(props: PanelProps) {
  const { state, setState, activeId, setActiveId } = props;
  return (
    <ActiveGate
      assessments={state.assessments}
      activeId={activeId}
      setActiveId={setActiveId}
      title="Assisted Checking"
    >
      {(active) => <CheckEditor active={active} state={state} setState={setState} />}
    </ActiveGate>
  );
}

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

// Rebuild teacher inputs from a previously saved result (for review/override).
function inputFromResult(result: Result | undefined): CheckingInput {
  const input = emptyInput();
  if (!result) return input;
  result.answers.forEach((a) => {
    input.responses[a.itemId] = a.response;
  });
  result.itemScores.forEach((s) => {
    if (s.manual) input.manualScores[s.itemId] = s.awarded;
    if (s.overridden) input.overrides[s.itemId] = s.awarded;
    if (s.remarks) input.remarks[s.itemId] = s.remarks;
  });
  return input;
}

function CheckEditor({
  active,
  state,
  setState,
}: {
  active: Assessment;
  state: QrAssessmentState;
  setState: PanelProps["setState"];
}) {
  const items: Item[] = state.items
    .filter((i) => i.assessmentId === active.id)
    .sort((a, b) => a.itemNumber - b.itemNumber);

  const [learnerId, setLearnerId] = useState("");
  const [version, setVersion] = useState<TestVersion>(active.versions[0] ?? "A");
  const [dirty, setDirty] = useState(false);
  const [qrText, setQrTextValue] = useState("");

  const activeVersion = active.versions.includes(version)
    ? version
    : active.versions[0] ?? "A";

  if (items.length === 0) {
    return (
      <Wrap title="Assisted Checking" subtitle={active.title}>
        <Empty text="This assessment has no items. Add items first." />
      </Wrap>
    );
  }
  if (state.learners.length === 0) {
    return (
      <Wrap title="Assisted Checking" subtitle={active.title}>
        <Empty text="No learners yet. Add learners first." />
      </Wrap>
    );
  }

  const versionKey: VersionKey =
    (state.answerKeys[active.id] ?? {})[activeVersion] ?? {};
  const learner = state.learners.find((l) => l.id === learnerId);

  // Switch learner/version, guarding against losing unsaved edits.
  function switchSelection(next: () => void) {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setDirty(false);
    next();
  }

  function applyQr() {
    const text = qrText.trim();
    if (!text) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      window.alert("Invalid QR payload: not valid JSON.");
      return;
    }
    const p = parsed as Record<string, unknown>;
    if (p.assessmentId !== active.id) {
      window.alert(
        "QR is for a different assessment. Set that assessment active first.",
      );
      return;
    }
    const lid = String(p.learnerId ?? "");
    if (!state.learners.some((l) => l.id === lid)) {
      window.alert("Learner from QR not found on this device.");
      return;
    }
    const v = String(p.version ?? "") as TestVersion;
    switchSelection(() => {
      setLearnerId(lid);
      if (active.versions.includes(v)) setVersion(v);
      setQrTextValue("");
    });
  }

  const existing = findResult(state.results, active.id, learnerId, activeVersion);
  const initialInput = inputFromResult(existing);

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">Assisted Checking</h1>
          <p className="mt-1 text-slate-500">
            {active.title} · {items.length} item(s)
          </p>
        </div>
      </div>

      <ScannerPlaceholder />

      {/* Selection */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-500">
              Learner
            </span>
            <select
              value={learnerId}
              onChange={(e) =>
                switchSelection(() => setLearnerId(e.target.value))
              }
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">— select learner —</option>
              {state.learners.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.fullName}
                  {l.section ? " (" + l.section + ")" : ""}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="mb-1 block text-xs font-bold text-slate-500">
              Version
            </span>
            <div className="flex gap-2">
              {active.versions.map((v) => {
                const on = v === activeVersion;
                const cls = on
                  ? "border-indigo-700 bg-indigo-700 text-white"
                  : "border-slate-200 bg-white text-slate-500";
                return (
                  <button
                    key={v}
                    onClick={() => switchSelection(() => setVersion(v))}
                    className={
                      "h-10 w-10 rounded-lg border text-base font-extrabold " + cls
                    }
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Optional QR paste */}
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-60 flex-1">
            <span className="mb-1 block text-xs font-bold text-slate-500">
              Paste QR payload (optional) to auto-select learner & version
            </span>
            <input
              value={qrText}
              onChange={(e) => setQrTextValue(e.target.value)}
              placeholder='{"assessmentId":"…","learnerId":"…","version":"A"}'
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs"
            />
          </label>
          <Button variant="ghost" onClick={applyQr}>
            Apply QR
          </Button>
        </div>

        {Object.keys(versionKey).length === 0 &&
        items.some((i) => isObjective(i.type)) ? (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
            ⚠ No answer key set for version {activeVersion}. Set it in the Items
            tab.
          </div>
        ) : null}
      </div>

      {learner ? (
        <CheckForm
          // Remount (and re-init inputs) whenever the selection changes.
          key={learnerId + "|" + activeVersion}
          active={active}
          items={items}
          versionKey={versionKey}
          learner={learner}
          version={activeVersion}
          initialInput={initialInput}
          alreadySaved={Boolean(existing)}
          dirty={dirty}
          onDirty={setDirty}
          setState={setState}
        />
      ) : (
        <Empty text="Select a learner to start checking." />
      )}
    </section>
  );
}

function CheckForm({
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

      {/* Option text reference for Multiple Choice / Matching */}
      {optionPairs(item).some((p) => p.text.trim()) ? (
        <div className="mt-1 grid gap-0.5 text-xs text-slate-500">
          {optionPairs(item).map((p) => (
            <div key={p.letter}>
              <b>{p.letter}.</b> {p.text || "—"}
            </div>
          ))}
        </div>
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

function isTextMatch(item: Item, keyAnswer: string, response: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  if (usesAcceptedAnswers(item.type)) {
    const accepted = item.acceptedAnswers.filter((s) => s.trim());
    if (item.correctAnswer.trim()) accepted.push(item.correctAnswer);
    return acceptedMatch(response, accepted);
  }
  return keyAnswer.trim() !== "" && norm(response) === norm(keyAnswer);
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

function Wrap({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h1 className="text-2xl font-extrabold">{title}</h1>
      <p className="mt-1 text-slate-500">{subtitle}</p>
      {children}
    </section>
  );
}
