// Phase 5 (+ revisions) — Items & Answer Key editor.
// Works on the active assessment. Add/edit/delete items, set option text and
// keys, and bulk-import items and answer keys.

import type { PanelProps } from "./panel-types";
import type {
  Assessment,
  Difficulty,
  Item,
  ItemType,
  QrAssessmentState,
  TestVersion,
  VersionKey,
} from "../lib/types";
import { DIFFICULTIES, ITEM_TYPES } from "../lib/types";
import {
  hasOptionText,
  isObjective,
  scoringMode,
  scoringModeLabel,
  usesAcceptedAnswers,
} from "../lib/items";
import type { ParsedItem } from "../lib/item-import";
import type { ParsedKeyEntry } from "../lib/answer-key-import";
import { uid } from "../lib/ids";
import { ActiveGate } from "./ActiveGate";
import { AnswerKeyEditor } from "./AnswerKeyEditor";
import { ItemImportSection } from "./ItemImportSection";
import { AnswerKeyImportSection } from "./AnswerKeyImportSection";
import { Button, Empty, Field, Pill, Select, TextInput } from "./ui";

export default function ItemsPanel(props: PanelProps) {
  const { state, setState, activeId, setActiveId } = props;

  return (
    <ActiveGate
      assessments={state.assessments}
      activeId={activeId}
      setActiveId={setActiveId}
      title="Items & Answer Key"
    >
      {(active) => (
        <ItemsEditor active={active} state={state} setState={setState} />
      )}
    </ActiveGate>
  );
}

function modePill(type: ItemType) {
  const mode = scoringMode(type);
  const tone = mode === "manual" ? "warn" : "good";
  return <Pill tone={tone}>{scoringModeLabel(type)}</Pill>;
}

function ItemsEditor({
  active,
  state,
  setState,
}: {
  active: Assessment;
  state: QrAssessmentState;
  setState: PanelProps["setState"];
}) {
  const items = state.items
    .filter((i) => i.assessmentId === active.id)
    .sort((a, b) => a.itemNumber - b.itemNumber);

  const objectiveItems = items.filter((i) => isObjective(i.type));

  function newItem(itemNumber: number): Item {
    return {
      id: uid("I_"),
      assessmentId: active.id,
      itemNumber,
      type: "Multiple Choice",
      question: "",
      correctAnswer: "",
      acceptedAnswers: [],
      points: 1,
      competency: "",
      difficulty: "Average",
      choices: 4,
      options: ["", "", "", ""],
    };
  }

  function addItem() {
    setState((prev) => ({
      ...prev,
      items: prev.items.concat(newItem(items.length + 1)),
    }));
  }

  function updateItem(id: string, changes: Partial<Item>) {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((i) => (i.id === id ? { ...i, ...changes } : i)),
    }));
  }

  function removeItem(id: string) {
    const hasResults = state.results.some((r) => r.assessmentId === active.id);
    const msg = hasResults
      ? "Delete this item? Results already exist for this assessment — saved scores will keep their old item snapshots, but this item will be removed from future checking and analysis."
      : "Delete this item?";
    if (!window.confirm(msg)) return;
    setState((prev) => {
      let n = 0;
      const nextItems = prev.items
        .filter((i) => i.id !== id)
        .map((i) => {
          if (i.assessmentId !== active.id) return i;
          n += 1;
          return { ...i, itemNumber: n };
        });
      const assessmentKeys = { ...(prev.answerKeys[active.id] ?? {}) };
      (Object.keys(assessmentKeys) as TestVersion[]).forEach((v) => {
        const versionKey = { ...(assessmentKeys[v] ?? {}) };
        delete versionKey[id];
        assessmentKeys[v] = versionKey;
      });
      return {
        ...prev,
        items: nextItems,
        answerKeys: { ...prev.answerKeys, [active.id]: assessmentKeys },
      };
    });
  }

  // Bulk item import. Append continues numbering; replace swaps all items.
  function importItems(rows: ParsedItem[], mode: "append" | "replace") {
    setState((prev) => {
      const others = prev.items.filter((i) => i.assessmentId !== active.id);
      const mine =
        mode === "replace"
          ? []
          : prev.items
              .filter((i) => i.assessmentId === active.id)
              .sort((a, b) => a.itemNumber - b.itemNumber);
      const start = mine.length;
      const created: Item[] = rows.map((p, i) => ({
        id: uid("I_"),
        assessmentId: active.id,
        itemNumber: start + i + 1,
        type: p.type,
        question: p.question,
        correctAnswer: p.correctAnswer,
        acceptedAnswers: p.acceptedAnswers,
        points: p.points,
        competency: p.competency,
        difficulty: p.difficulty,
        choices: p.choices,
        options: p.options,
      }));
      const nextItems = others.concat(mine, created);
      // On replace, drop this assessment's now-orphaned answer keys.
      const answerKeys =
        mode === "replace"
          ? { ...prev.answerKeys, [active.id]: {} }
          : prev.answerKeys;
      return { ...prev, items: nextItems, answerKeys };
    });
  }

  function keyFor(version: TestVersion): VersionKey {
    const assessmentKeys = state.answerKeys[active.id] ?? {};
    return assessmentKeys[version] ?? {};
  }

  function setKey(version: TestVersion, itemId: string, value: string) {
    setState((prev) => {
      const assessmentKeys = { ...(prev.answerKeys[active.id] ?? {}) };
      const versionKey = { ...(assessmentKeys[version] ?? {}) };
      if (value === "") delete versionKey[itemId];
      else versionKey[itemId] = value;
      assessmentKeys[version] = versionKey;
      return {
        ...prev,
        answerKeys: { ...prev.answerKeys, [active.id]: assessmentKeys },
      };
    });
  }

  // Apply bulk answer-key entries by item number → itemId, per version.
  function applyKeyEntries(entries: ParsedKeyEntry[]): {
    applied: number;
    unknown: number[];
  } {
    const byNumber = new Map(items.map((i) => [i.itemNumber, i]));
    const unknown: number[] = [];
    let applied = 0;
    setState((prev) => {
      const assessmentKeys = { ...(prev.answerKeys[active.id] ?? {}) };
      entries.forEach((e) => {
        const item = byNumber.get(e.itemNumber);
        if (!item) {
          if (!unknown.includes(e.itemNumber)) unknown.push(e.itemNumber);
          return;
        }
        const versionKey = { ...(assessmentKeys[e.version] ?? {}) };
        versionKey[item.id] = e.answer;
        assessmentKeys[e.version] = versionKey;
        applied += 1;
      });
      return {
        ...prev,
        answerKeys: { ...prev.answerKeys, [active.id]: assessmentKeys },
      };
    });
    return { applied, unknown };
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">Items & Answer Key</h1>
          <p className="mt-1 text-slate-500">
            {active.title} · {items.length} item(s)
          </p>
        </div>
        <Button onClick={addItem}>+ Add Item</Button>
      </div>

      <ItemImportSection existingCount={items.length} onImport={importItems} />

      {items.length === 0 ? (
        <Empty text="No items yet. Add one, or bulk-import above." />
      ) : (
        <div className="mt-4 grid gap-3">
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onChange={(changes) => updateItem(item.id, changes)}
              onRemove={() => removeItem(item.id)}
            />
          ))}
        </div>
      )}

      <AnswerKeyEditor
        objectiveItems={objectiveItems}
        versions={active.versions}
        keyFor={keyFor}
        onSetKey={setKey}
      />

      <AnswerKeyImportSection
        versions={active.versions}
        itemNumbers={items.map((i) => i.itemNumber)}
        onApply={applyKeyEntries}
      />
    </section>
  );
}

function ItemCard({
  item,
  onChange,
  onRemove,
}: {
  item: Item;
  onChange: (changes: Partial<Item>) => void;
  onRemove: () => void;
}) {
  const acceptedRaw = item.acceptedAnswers.join(", ");
  const showOptions = hasOptionText(item.type);

  function setChoices(n: number) {
    const options = Array.from({ length: n }, (_, i) => item.options[i] ?? "");
    onChange({ choices: n, options });
  }
  function setOption(index: number, text: string) {
    const n = Math.max(item.choices, index + 1);
    const options = Array.from({ length: n }, (_, i) =>
      i === index ? text : item.options[i] ?? "",
    );
    onChange({ options });
  }

  // Integrity warnings surfaced inline (non-blocking).
  const warnings: string[] = [];
  if (item.points <= 0) warnings.push("Zero points");
  if (!item.question.trim()) warnings.push("No question text");
  if (showOptions && !item.options.some((o) => o.trim()))
    warnings.push("No option text");

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-indigo-700 px-1 text-sm font-bold text-white">
          {item.itemNumber}
        </span>
        <Select
          value={item.type}
          onChange={(e) => onChange({ type: e.target.value as ItemType })}
          className="max-w-48"
        >
          {ITEM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <TextInput
          type="number"
          min={0}
          value={item.points}
          onChange={(e) =>
            onChange({ points: Math.max(0, Number(e.target.value) || 0) })
          }
          className="max-w-20"
        />
        <span className="text-xs text-slate-500">pts</span>
        {modePill(item.type)}
        <Button variant="smallDanger" className="ml-auto" onClick={onRemove}>
          ✕
        </Button>
      </div>

      <textarea
        value={item.question}
        onChange={(e) => onChange({ question: e.target.value })}
        placeholder="Question text"
        className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500"
      />

      {showOptions && (
        <div className="mt-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500">Choices</span>
            <Select
              value={item.choices}
              onChange={(e) => setChoices(Number(e.target.value))}
              className="max-w-20"
            >
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            {Array.from({ length: item.choices }, (_, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-sm font-bold text-slate-600">
                  {String.fromCharCode(65 + i)}
                </span>
                <TextInput
                  value={item.options[i] ?? ""}
                  onChange={(e) => setOption(i, e.target.value)}
                  placeholder={`Option ${String.fromCharCode(65 + i)} text`}
                  className="flex-1"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Field label="Competency">
          <TextInput
            value={item.competency}
            onChange={(e) => onChange({ competency: e.target.value })}
            placeholder="e.g. M11GM-Ia-1"
            className="min-w-40"
          />
        </Field>
        <Field label="Difficulty">
          <Select
            value={item.difficulty}
            onChange={(e) =>
              onChange({ difficulty: e.target.value as Difficulty })
            }
            className="max-w-32"
          >
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        {usesAcceptedAnswers(item.type) && (
          <Field label="Accepted Answers (comma-separated)">
            <TextInput
              value={acceptedRaw}
              onChange={(e) =>
                onChange({
                  acceptedAnswers: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter((s) => s.length > 0),
                })
              }
              placeholder="e.g. target customers, target consumers"
              className="min-w-52"
            />
          </Field>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="mt-2 text-xs font-bold text-amber-600">
          ⚠ {warnings.join(" · ")}
        </div>
      )}
    </div>
  );
}
