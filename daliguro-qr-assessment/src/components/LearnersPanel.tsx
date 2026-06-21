// Phase 6 (+ revisions) — Learner Manager.
// Manual entry plus CSV import (paste or file) with preview, Sex normalisation,
// and duplicate-LRN handling. Learners are shared across assessments.

import { useState } from "react";
import type { PanelProps } from "./panel-types";
import type { Learner, Sex } from "../lib/types";
import type { ParsedLearner } from "../lib/learner-import";
import { uid } from "../lib/ids";
import { LearnerImportSection } from "./LearnerImportSection";
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

export default function LearnersPanel(props: PanelProps) {
  const { state, setState } = props;
  const [form, setForm] = useState<LearnerForm>(emptyForm);
  const [query, setQuery] = useState("");

  function addManual() {
    if (!form.fullName.trim()) {
      window.alert("Full name is required.");
      return;
    }
    const learner: Learner = {
      id: uid("L_"),
      ...form,
      fullName: form.fullName.trim(),
    };
    setState((prev) => ({ ...prev, learners: prev.learners.concat(learner) }));
    setForm((prev) => ({ ...prev, lrn: "", fullName: "" }));
  }

  // Merge an import: add fresh learners, overwrite duplicates by LRN.
  function importLearners(toAdd: ParsedLearner[], toUpdate: ParsedLearner[]) {
    setState((prev) => {
      const updateByLrn = new Map(
        toUpdate.filter((u) => u.lrn.trim()).map((u) => [u.lrn.trim(), u]),
      );
      const learners = prev.learners.map((l) => {
        const u = updateByLrn.get(l.lrn.trim());
        return u
          ? {
              ...l,
              fullName: u.fullName,
              sex: u.sex,
              gradeLevel: u.gradeLevel,
              section: u.section,
            }
          : l;
      });
      const added: Learner[] = toAdd.map((p) => ({
        id: uid("L_"),
        lrn: p.lrn,
        fullName: p.fullName,
        sex: p.sex,
        gradeLevel: p.gradeLevel,
        section: p.section,
      }));
      return { ...prev, learners: learners.concat(added) };
    });
    window.alert(
      `Imported ${toAdd.length} new learner(s)` +
        (toUpdate.length ? `, updated ${toUpdate.length}.` : "."),
    );
  }

  function remove(id: string) {
    const hasResults = state.results.some((r) => r.learnerId === id);
    const msg = hasResults
      ? "This learner has saved results. Deleting them will leave those results without a matching learner. Delete anyway?"
      : "Delete this learner?";
    if (!window.confirm(msg)) return;
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
      <h1 className="text-2xl font-extrabold">
        Learner Manager ({state.learners.length})
      </h1>
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

      <LearnerImportSection
        existingLrns={state.learners.map((l) => l.lrn)}
        onImport={importLearners}
      />

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
