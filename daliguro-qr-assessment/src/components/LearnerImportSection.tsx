// Learner CSV import UI: paste or file, preview with duplicate-LRN handling.

import { useRef, useState } from "react";
import type { ParsedLearner } from "../lib/learner-import";
import { flagDuplicateLrns, parseLearnersCsv } from "../lib/learner-import";
import { Button } from "./ui";

export function LearnerImportSection({
  existingLrns,
  onImport,
}: {
  existingLrns: string[];
  // toAdd = new learners; toUpdate = duplicate-LRN rows to overwrite (or []).
  onImport: (toAdd: ParsedLearner[], toUpdate: ParsedLearner[]) => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ParsedLearner[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [parsed, setParsed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { duplicates, fresh } = flagDuplicateLrns(rows, existingLrns);
  const dupIds = new Set(duplicates.map((d) => d.row));

  function doParse(raw: string) {
    const result = parseLearnersCsv(raw);
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

  function importSkip() {
    onImport(fresh, []);
    reset();
  }
  function importUpdate() {
    onImport(fresh, duplicates);
    reset();
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-slate-700">
          Import learners (CSV)
        </span>
        <Button variant="small" onClick={() => fileRef.current?.click()}>
          Choose CSV file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={onFile}
        />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Header: LRN, Full Name, Sex, Grade Level, Section. Sex accepts M / F /
        Male / Female. Quoted names with commas are kept whole.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={
          'LRN,Full Name,Sex,Grade Level,Section\n123456789012,"Dela Cruz, Juan",Male,11,STEM-A'
        }
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
            <div className="text-sm text-slate-500">No valid learner rows.</div>
          ) : (
            <>
              <div className="text-xs text-slate-500">
                {fresh.length} new · {duplicates.length} duplicate LRN(s)
              </div>
              <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      {["LRN", "Name", "Sex", "Grade", "Section", ""].map((h) => (
                        <th key={h} className="px-2 py-1 font-bold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.row} className="border-t border-slate-100">
                        <td className="px-2 py-1">{r.lrn || "—"}</td>
                        <td className="px-2 py-1 font-semibold">{r.fullName}</td>
                        <td className="px-2 py-1">{r.sex}</td>
                        <td className="px-2 py-1">{r.gradeLevel}</td>
                        <td className="px-2 py-1">{r.section}</td>
                        <td className="px-2 py-1">
                          {dupIds.has(r.row) ? (
                            <span className="text-amber-600">duplicate</span>
                          ) : (
                            <span className="text-emerald-600">new</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={importSkip}>
                  Import {fresh.length} new (skip duplicates)
                </Button>
                {duplicates.length > 0 && (
                  <Button variant="ghost" onClick={importUpdate}>
                    Also update {duplicates.length} duplicate(s)
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
