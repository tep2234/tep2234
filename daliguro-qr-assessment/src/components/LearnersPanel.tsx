// Phase 6 — Learner Manager.
// Manual entry, CSV import (paste or file), search, and delete.
// Learners are shared across assessments.

import { useRef, useState } from "react";
import type { PanelProps } from "./panel-types";
import type { Learner, Sex } from "../lib/types";
import { uid } from "../lib/ids";
import { Button, Empty, Field, Select, TextInput } from "./ui";

interface LearnerForm {
  lrn: string;
  fullName: string;
  sex: Sex;
  gradeLevel: string;
  section: string;
}

function emptyForm(): LearnerForm {
  return { lrn: "", fullName: "", sex: "M", gradeLevel: "11", section: "" };
}

// Split a CSV line, tolerating simple quoted fields.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Parse CSV text into learners. Header: LRN, Full Name, Sex, Grade Level, Section.
function parseLearnersCsv(text: string): Learner[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  function indexOfAny(names: string[]): number {
    for (const name of names) {
      const pos = header.indexOf(name);
      if (pos >= 0) return pos;
    }
    return -1;
  }

  const iLrn = indexOfAny(["lrn"]);
  const iName = indexOfAny(["full name", "name", "fullname"]);
  const iSex = indexOfAny(["sex"]);
  const iGrade = indexOfAny(["grade level", "grade"]);
  const iSection = indexOfAny(["section"]);

  const learners: Learner[] = [];
  for (let r = 1; r < lines.length; r += 1) {
    const cols = splitCsvLine(lines[r]);
    const fullName = iName >= 0 ? cols[iName] ?? "" : cols[0] ?? "";
    if (!fullName) continue;
    const sexRaw = iSex >= 0 ? (cols[iSex] ?? "M").toUpperCase() : "M";
    learners.push({
      id: uid("L_"),
      lrn: iLrn >= 0 ? cols[iLrn] ?? "" : "",
      fullName,
      sex: sexRaw === "F" ? "F" : "M",
      gradeLevel: iGrade >= 0 ? cols[iGrade] ?? "11" : "11",
      section: iSection >= 0 ? cols[iSection] ?? "" : "",
    });
  }
  return learners;
}

export default function LearnersPanel(props: PanelProps) {
  const { state, setState } = props;
  const [form, setForm] = useState<LearnerForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [csvText, setCsvText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function addManual() {
    if (!form.fullName.trim()) {
      window.alert("Full name is required.");
      return;
    }
    const learner: Learner = { id: uid("L_"), ...form, fullName: form.fullName.trim() };
    setState((prev) => ({ ...prev, learners: prev.learners.concat(learner) }));
    setForm((prev) => ({ ...prev, lrn: "", fullName: "" }));
  }

  function importText(text: string) {
    const parsed = parseLearnersCsv(text);
    if (parsed.length === 0) {
      window.alert("No learners found. Expected header: LRN, Full Name, Sex, Grade Level, Section");
      return;
    }
    setState((prev) => ({ ...prev, learners: prev.learners.concat(parsed) }));
    setCsvText("");
    window.alert("Imported " + parsed.length + " learner(s).");
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importText(String(reader.result));
    reader.readAsText(file);
    e.target.value = "";
  }

  function remove(id: string) {
    setState((prev) => ({
      ...prev,
      learners: prev.learners.filter((l) => l.id !== id),
    }));
  }

  const visible = state.learners.filter((l) =>
    l.fullName.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">
          Learner Manager ({state.learners.length})
        </h1>
        <Button variant="ghost" onClick={() => fileRef.current?.click()}>
          ⬆ Import CSV file
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
        CSV header: LRN, Full Name, Sex, Grade Level, Section
      </p>

      {/* Manual add */}
      <div className="mt-4 grid grid-cols-2 items-end gap-2 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-6">
        <Field label="LRN">
          <TextInput
            value={form.lrn}
            onChange={(e) => setForm((p) => ({ ...p, lrn: e.target.value }))}
          />
        </Field>
        <Field label="Full Name">
          <TextInput
            value={form.fullName}
            onChange={(e) => setForm((p) => ({ ...p, fullName: e.target.value }))}
          />
        </Field>
        <Field label="Sex">
          <Select
            value={form.sex}
            onChange={(e) => setForm((p) => ({ ...p, sex: e.target.value as Sex }))}
          >
            <option value="M">M</option>
            <option value="F">F</option>
          </Select>
        </Field>
        <Field label="Grade">
          <TextInput
            value={form.gradeLevel}
            onChange={(e) => setForm((p) => ({ ...p, gradeLevel: e.target.value }))}
          />
        </Field>
        <Field label="Section">
          <TextInput
            value={form.section}
            onChange={(e) => setForm((p) => ({ ...p, section: e.target.value }))}
          />
        </Field>
        <Button onClick={addManual}>+ Add</Button>
      </div>

      {/* CSV paste */}
      <div className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
        <span className="mb-1 block text-xs font-bold text-slate-500">
          Or paste CSV text
        </span>
        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={"LRN,Full Name,Sex,Grade Level,Section\n123456789012,Dela Cruz Juan,M,11,STEM-A"}
          className="min-h-24 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
        />
        <div className="mt-2">
          <Button variant="small" onClick={() => importText(csvText)}>
            Import pasted CSV
          </Button>
        </div>
      </div>

      {/* Search + table */}
      <div className="mt-4">
        <TextInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search learner by name…"
        />
      </div>

      {visible.length === 0 ? (
        <Empty text={state.learners.length === 0 ? "No learners yet." : "No matches."} />
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                {["#", "LRN", "Name", "Sex", "Grade", "Section", ""].map((h, i) => (
                  <th key={i} className="px-3 py-2 font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((l, i) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{i + 1}</td>
                  <td className="px-3 py-2">{l.lrn}</td>
                  <td className="px-3 py-2 font-semibold">{l.fullName}</td>
                  <td className="px-3 py-2">{l.sex}</td>
                  <td className="px-3 py-2">{l.gradeLevel}</td>
                  <td className="px-3 py-2">{l.section}</td>
                  <td className="px-3 py-2">
                    <Button variant="smallDanger" onClick={() => remove(l.id)}>
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
