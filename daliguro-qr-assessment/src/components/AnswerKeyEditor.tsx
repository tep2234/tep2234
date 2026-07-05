// Phase 5 — Answer Key editor (per version).
// Keys are stored locally and NEVER embedded in QR codes.

import { useState } from "react";
import type { Item, TestVersion, VersionKey } from "../lib/types";
import { optionSet } from "../lib/items";
import { Empty, TextInput } from "./ui";

export function AnswerKeyEditor({
  objectiveItems,
  versions,
  keyFor,
  onSetKey,
}: {
  objectiveItems: Item[];
  versions: TestVersion[];
  keyFor: (version: TestVersion) => VersionKey;
  onSetKey: (version: TestVersion, itemId: string, value: string) => void;
}) {
  const [version, setVersion] = useState<TestVersion>(versions[0] ?? "A");
  const activeVersion = versions.includes(version) ? version : versions[0];
  const currentKey = keyFor(activeVersion);

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-base font-bold">🔐 Answer Key</h2>
      <p className="mt-1 text-sm text-slate-500">
        Stored on this device only — never placed inside QR codes. Set keys per
        version.
      </p>

      <div className="mt-3">
        <span className="mb-1 block text-xs font-bold text-slate-500">
          Editing version
        </span>
        <div className="flex gap-2">
          {versions.map((v) => {
            const on = v === activeVersion;
            const cls = on
              ? "border-indigo-700 bg-indigo-700 text-white"
              : "border-slate-200 bg-white text-slate-500";
            return (
              <button
                key={v}
                onClick={() => setVersion(v)}
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

      {objectiveItems.length === 0 ? (
        <Empty text="Add Multiple Choice, True/False, Matching, or Sequencing items to set keys." />
      ) : (
        <div className="mt-3 grid gap-2">
          {objectiveItems.map((item) => (
            <KeyRow
              key={item.id}
              item={item}
              value={currentKey[item.id] ?? ""}
              onChange={(val) => onSetKey(activeVersion, item.id, val)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KeyRow({
  item,
  value,
  onChange,
}: {
  item: Item;
  value: string;
  onChange: (value: string) => void;
}) {
  const options = optionSet(item);
  const label = item.question.trim() === "" ? "(no question text)" : item.question;

  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-md bg-indigo-700 px-1 text-sm font-bold text-white">
        {item.itemNumber}
      </span>
      <span className="flex-1 truncate text-sm text-slate-500">{label}</span>
      {options ? (
        <div className="flex gap-1.5">
          {options.map((opt) => {
            const on = value === opt;
            const cls = on
              ? "border-emerald-600 bg-emerald-600 text-white"
              : "border-slate-200 bg-white text-slate-500";
            return (
              <button
                key={opt}
                onClick={() => onChange(on ? "" : opt)}
                className={"h-9 w-9 rounded-lg border text-sm font-bold " + cls}
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : (
        <TextInput
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. 3,1,2,4"
          className="max-w-40"
        />
      )}
    </div>
  );
}
