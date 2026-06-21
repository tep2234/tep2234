// Bulk answer-key import UI with preview, applied per version by item number.
// Keys are stored locally only — never embedded in QR codes.

import { useState } from "react";
import type { TestVersion } from "../lib/types";
import type { ParsedKeyEntry } from "../lib/answer-key-import";
import { parseAnswerKeyCsv } from "../lib/answer-key-import";
import { Button } from "./ui";

export function AnswerKeyImportSection({
  versions,
  itemNumbers,
  onApply,
}: {
  versions: TestVersion[];
  itemNumbers: number[];
  onApply: (entries: ParsedKeyEntry[]) => { applied: number; unknown: number[] };
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedKeyEntry[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [parsed, setParsed] = useState(false);

  const known = new Set(itemNumbers);
  const validVersions = new Set(versions);

  function doParse(raw: string) {
    const result = parseAnswerKeyCsv(raw);
    // Filter to versions this assessment actually has.
    const usable = result.rows.filter((r) => validVersions.has(r.version));
    const dropped = result.rows.length - usable.length;
    const errs = [...result.errors];
    if (dropped > 0)
      errs.push(`${dropped} row(s) skipped: version not enabled for this assessment.`);
    setRows(usable);
    setErrors(errs);
    setParsed(true);
  }

  function reset() {
    setText("");
    setRows([]);
    setErrors([]);
    setParsed(false);
  }

  function apply() {
    if (rows.length === 0) return;
    const { applied, unknown } = onApply(rows);
    let msg = `Applied ${applied} answer-key entr(ies).`;
    if (unknown.length > 0)
      msg += ` Item number(s) not found: ${unknown.join(", ")}.`;
    window.alert(msg);
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="mt-3">
        <Button variant="ghost" onClick={() => setOpen(true)}>
          ⬆ Import Answer Keys (bulk)
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">⬆ Import Answer Keys</h2>
        <button
          className="text-xs font-bold text-slate-400 hover:text-slate-700"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          close
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Columns: Item No, Version, Answer. Applied per version by item number.
        Keys never enter QR codes.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Item No,Version,Answer\n1,A,B\n2,A,T\n3,A,target market"}
        className="mt-2 min-h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
      />
      <div className="mt-2">
        <Button variant="small" onClick={() => doParse(text)}>
          Preview
        </Button>
      </div>

      {parsed && (
        <div className="mt-3">
          {errors.length > 0 && (
            <ul className="mb-2 list-inside list-disc rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
          {rows.length === 0 ? (
            <div className="text-sm text-slate-500">No usable key rows.</div>
          ) : (
            <>
              <div className="overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      {["Item No", "Version", "Answer", ""].map((h) => (
                        <th key={h} className="px-2 py-1 font-bold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => {
                      const ok = known.has(r.itemNumber);
                      return (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-2 py-1">{r.itemNumber}</td>
                          <td className="px-2 py-1">{r.version}</td>
                          <td className="px-2 py-1">{r.answer}</td>
                          <td className="px-2 py-1">
                            {ok ? (
                              <span className="text-emerald-600">✓</span>
                            ) : (
                              <span className="text-red-600">no such item</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3">
                <Button onClick={apply}>Apply keys</Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
