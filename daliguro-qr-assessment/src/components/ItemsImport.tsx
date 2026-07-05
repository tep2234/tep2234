// Items + answer-key CSV import UI for the Items tab.
// Collapsible: file upload, paste box, and a template download that matches
// the active assessment's versions. Parsing/validation lives in lib/items-csv.

import { useRef, useState } from "react";
import type { TestVersion } from "../lib/types";
import { downloadCsv, toCsv } from "../lib/export";
import { Button } from "./ui";

export function ItemsImport({
  versions,
  onImport,
}: {
  versions: TestVersion[];
  onImport: (csvText: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onImport(String(reader.result));
    reader.readAsText(file);
    e.target.value = "";
  }

  function downloadTemplate() {
    const answerCols = versions.map((v) => "answerVersion" + v);
    const headers = [
      "itemNo",
      "type",
      "question",
      "optionA",
      "optionB",
      "optionC",
      "optionD",
      ...answerCols,
      "points",
      "competency",
      "topic",
      "difficulty",
      "cognitiveLevel",
    ];
    const example = [
      "1",
      "Multiple Choice",
      "Which statement best describes entrepreneurship?",
      "Copying an existing business",
      "Creating value by solving a customer problem",
      "Selling only when prices are low",
      "Avoiding all business risks",
      ...versions.map((v) => (v === "A" ? "B" : "D")),
      "1",
      "Recognizing opportunity",
      "Entrepreneurial Mindset",
      "Average",
      "Understanding",
    ];
    downloadCsv(toCsv(headers, [example]), "daliguro_items_template.csv");
  }

  if (!open) {
    return (
      <div className="mt-3">
        <Button variant="ghost" onClick={() => setOpen(true)}>
          ⬆ Import items from CSV
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold text-indigo-900">
          ⬆ Import items &amp; answer key (CSV)
        </h2>
        <button
          className="text-xs font-bold text-indigo-700"
          onClick={() => setOpen(false)}
        >
          close
        </button>
      </div>
      <p className="mt-1 text-xs text-indigo-900/80">
        Columns: <code>itemNo, type, question, optionA–D,
        {" "}
        {versions.map((v) => "answerVersion" + v).join(", ")}, points,
        competency, difficulty</code>. Answer letters fill the per-version key —
        they are never written into a QR. Importing <b>replaces</b> this
        assessment's existing items.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
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
        <Button variant="small" onClick={downloadTemplate}>
          ⬇ Download template
        </Button>
      </div>

      <div className="mt-3">
        <span className="mb-1 block text-xs font-bold text-slate-500">
          …or paste CSV text
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            "itemNo,type,question,optionA,optionB,optionC,optionD," +
            versions.map((v) => "answerVersion" + v).join(",") +
            ",points,competency,difficulty"
          }
          className="min-h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
        />
        <div className="mt-2">
          <Button
            variant="small"
            onClick={() => {
              if (text.trim()) onImport(text);
            }}
          >
            Import pasted CSV
          </Button>
        </div>
      </div>
    </div>
  );
}
