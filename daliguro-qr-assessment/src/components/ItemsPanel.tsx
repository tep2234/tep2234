// Phase 5 — Items & Answer Key editor.
// Works on the active assessment. Add/edit/delete items, then set keys.

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
import { isObjective, usesAcceptedAnswers } from "../lib/items";
import { buildItemsImport, parseItemsCsv } from "../lib/items-csv";
import { uid } from "../lib/ids";
import { ActiveGate } from "./ActiveGate";
import { AnswerKeyEditor } from "./AnswerKeyEditor";
import { ItemsImport } from "./ItemsImport";
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

  function addItem() {
    const item: Item = {
      id: uid("I_"),
      assessmentId: active.id,
      itemNumber: items.length + 1,
      type: "Multiple Choice",
      question: "",
      correctAnswer: "",
      acceptedAnswers: [],
      points: 1,
      competency: "",
      difficulty: "Average",
      choices: 4,
    };
    setState((prev) => ({ ...prev, items: prev.items.concat(item) }));
  }

  function updateItem(id: string, changes: Partial<Item>) {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((i) => (i.id === id ? { ...i, ...changes } : i)),
    }));
  }

  function removeItem(id: string) {
    setState((prev) => {
      // Drop the item, renumber the rest of this assessment's items.
      let n = 0;
      const nextItems = prev.items
        .filter((i) => i.id !== id)
        .map((i) => {
          if (i.assessmentId !== active.id) return i;
          n += 1;
          return { ...i, itemNumber: n };
        });
      // Remove this item's key from every version.
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

  // Bulk import items + answer keys from CSV. Replaces this assessment's items.
  function importItemsCsv(csvText: string) {
    const parsed = parseItemsCsv(csvText);
    if (parsed.items.length === 0) {
      window.alert(
        "No items imported.\n\n" +
          (parsed.errors.join("\n") || "Check the CSV header and contents."),
      );
      return;
    }
    const built = buildItemsImport(active.id, parsed.items);

    // Keys only for versions enabled on this assessment; note the rest.
    const allowed = parsed.versions.filter((v) => active.versions.includes(v));
    const notEnabled = parsed.versions.filter((v) => !active.versions.includes(v));
    const keys: Partial<Record<TestVersion, VersionKey>> = {};
    allowed.forEach((v) => {
      if (built.keys[v]) keys[v] = built.keys[v];
    });

    if (
      items.length > 0 &&
      !window.confirm(
        "Replace this assessment's " +
          items.length +
          " existing item(s) with " +
          built.items.length +
          " imported item(s)?",
      )
    ) {
      return;
    }

    setState((prev) => ({
      ...prev,
      items: prev.items
        .filter((i) => i.assessmentId !== active.id)
        .concat(built.items),
      answerKeys: { ...prev.answerKeys, [active.id]: keys },
    }));

    const lines = [
      "Imported " + built.items.length + " item(s).",
      "Answer keys set for version(s): " + (allowed.join(", ") || "none"),
    ];
    if (notEnabled.length > 0) {
      lines.push(
        "CSV also had version(s) " +
          notEnabled.join(", ") +
          " — enable them in Setup to use those keys.",
      );
    }
    if (parsed.errors.length > 0) {
      lines.push("", "Notes:", ...parsed.errors);
    }
    window.alert(lines.join("\n"));
  }

  function keyFor(version: TestVersion): VersionKey {
    const assessmentKeys = state.answerKeys[active.id] ?? {};
    return assessmentKeys[version] ?? {};
  }

  function setKey(version: TestVersion, itemId: string, value: string) {
    setState((prev) => {
      const assessmentKeys = { ...(prev.answerKeys[active.id] ?? {}) };
      const versionKey = { ...(assessmentKeys[version] ?? {}) };
      if (value === "") {
        delete versionKey[itemId];
      } else {
        versionKey[itemId] = value;
      }
      assessmentKeys[version] = versionKey;
      return {
        ...prev,
        answerKeys: { ...prev.answerKeys, [active.id]: assessmentKeys },
      };
    });
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

      <ItemsImport versions={active.versions} onImport={importItemsCsv} />

      {items.length === 0 ? (
        <Empty text="No items yet. Add your first question." />
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
          min={1}
          value={item.points}
          onChange={(e) =>
            onChange({ points: Math.max(1, Number(e.target.value) || 1) })
          }
          className="max-w-20"
        />
        <span className="text-xs text-slate-500">pts</span>
        {isObjective(item.type) ? (
          <Pill tone="info">objective</Pill>
        ) : (
          <Pill tone="warn">manual</Pill>
        )}
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

      <div className="mt-2 flex flex-wrap gap-2">
        {(item.type === "Multiple Choice" || item.type === "Matching Type") && (
          <Field label="Choices">
            <Select
              value={item.choices}
              onChange={(e) => onChange({ choices: Number(e.target.value) })}
              className="max-w-24"
            >
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        )}
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
              placeholder="e.g. 12, twelve"
              className="min-w-52"
            />
          </Field>
        )}
      </div>
    </div>
  );
}
