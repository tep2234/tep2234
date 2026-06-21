// Bulk item import UI (paste or file) with preview, then append or replace.

import { useRef, useState } from "react";
import type { ParsedItem } from "../lib/item-import";
import { parseItemsCsv } from "../lib/item-import";
import { Button } from "./ui";

const TEMPLATE =
  "Item No,Type,Question,A,B,C,D,E,Correct Answer,Accepted Answers,Points,Competency,Difficulty\n" +
  '1,Multiple Choice,What is the main purpose of market research?,To guess customer needs,To understand customer needs,To copy competitors,To avoid selling,,B,,1,Market Need Analysis,Easy\n' +
  "2,True or False,A business idea should be tested before launching,,,,,,T,,1,Business Validation,Easy\n" +
  '3,Identification,What do you call the group most likely to buy your product?,,,,,,target market,"target customers,target consumers",2,Target Market,Average\n' +
  "4,Essay,Explain why customer feedback matters.,,,,,,,,5,Customer Feedback,Average";

export function ItemImportSection({
  existingCount,
  onImport,
}: {
  existingCount: number;
  onImport: (rows: ParsedItem[], mode: "append" | "replace") => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedItem[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [parsed, setParsed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function doParse(raw: string) {
    const result = parseItemsCsv(raw);
    setRows(result.rows);
    setErrors(result.errors);
    setParsed(true);
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result);
      setText(content);
      doParse(content);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function reset() {
    setText("");
    setRows([]);
    setErrors([]);
    setParsed(false);
  }

  function append() {
    if (rows.length === 0) return;
    onImport(rows, "append");
    reset();
    setOpen(false);
  }

  function replace() {
    if (rows.length === 0) return;
    if (
      existingCount > 0 &&
      !window.confirm(
        `Replace all ${existingCount} existing item(s) with these ${rows.length}? This also clears their answer keys.`,
      )
    )
      return;
    onImport(rows, "replace");
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="mt-4">
        <Button variant="ghost" onClick={() => setOpen(true)}>
          ⬆ Import Items (bulk)
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">⬆ Import Items</h2>
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
        Columns: Item No, Type, Question, A, B, C, D, E, Correct Answer, Accepted
        Answers, Points, Competency, Difficulty. Quoted commas are supported.
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="small" onClick={() => fileRef.current?.click()}>
          Choose CSV file
        </Button>
        <Button
          variant="small"
          onClick={() => {
            setText(TEMPLATE);
            doParse(TEMPLATE);
          }}
        >
          Load sample
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={onFile}
        />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste item CSV here…"
        className="mt-2 min-h-28 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
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
            <div className="text-sm text-slate-500">
              No valid item rows found.
            </div>
          ) : (
            <>
              <div className="overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      {["#", "Type", "Question", "Key", "Pts", "Notes"].map(
                        (h) => (
                          <th key={h} className="px-2 py-1 font-bold">
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-2 py-1">{i + 1}</td>
                        <td className="px-2 py-1">{r.type}</td>
                        <td className="max-w-64 truncate px-2 py-1">
                          {r.question || "—"}
                        </td>
                        <td className="px-2 py-1">{r.correctAnswer || "—"}</td>
                        <td className="px-2 py-1">{r.points}</td>
                        <td className="px-2 py-1 text-amber-600">
                          {r.warnings.join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={append}>
                  Append {rows.length} item(s)
                </Button>
                <Button variant="smallDanger" onClick={replace}>
                  Replace all with these
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
