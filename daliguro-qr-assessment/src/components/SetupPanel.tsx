// Phase 4 — Assessment Setup.
// Create, edit, delete, and select the active assessment. Saved locally.

import { useState } from "react";
import type { PanelProps } from "./panel-types";
import type {
  Assessment,
  AssessmentComponent,
  QrAssessmentState,
  Term,
  TestVersion,
} from "../lib/types";
import {
  ASSESSMENT_COMPONENTS,
  TERMS,
  TEST_VERSIONS,
} from "../lib/types";
import { uid } from "../lib/ids";
import { buildDemoBundle, withDemoBundle } from "../lib/demo";
import { StartGuide } from "./StartGuide";
import { BackupTools } from "./BackupTools";
import { Button, Field, Pill, Select, TextInput } from "./ui";

const GRADE_LEVELS = ["7", "8", "9", "10", "11", "12"];

function newAssessment(): Assessment {
  const now = Date.now();
  return {
    id: uid("A_"),
    title: "",
    subject: "",
    gradeLevel: "11",
    section: "",
    schoolYear: "2026-2027",
    term: "First",
    component: "Written Work",
    versions: ["A"],
    teacherName: "",
    createdAt: now,
    updatedAt: now,
  };
}

// Remove an assessment and everything attached to it.
function cascadeDelete(
  state: QrAssessmentState,
  assessmentId: string,
): QrAssessmentState {
  const answerKeys = { ...state.answerKeys };
  delete answerKeys[assessmentId];
  return {
    ...state,
    assessments: state.assessments.filter((a) => a.id !== assessmentId),
    items: state.items.filter((i) => i.assessmentId !== assessmentId),
    results: state.results.filter((r) => r.assessmentId !== assessmentId),
    answerKeys,
  };
}

export default function SetupPanel(props: PanelProps) {
  const { state, setState, activeId, setActiveId } = props;
  const [editing, setEditing] = useState<Assessment | null>(null);

  function startNew() {
    setEditing(newAssessment());
  }

  // Load (or refresh) the shared demo. Fixed IDs => same on every device, so a
  // sheet from one device's demo scans correctly on another.
  function loadDemo() {
    const bundle = buildDemoBundle();
    setState((prev) => withDemoBundle(prev, bundle));
    setActiveId(bundle.assessment.id);
    window.alert("Demo assessment loaded and set active. It has the same IDs on every device, so its printed sheets scan anywhere.");
  }

  function save(draft: Assessment) {
    const title = draft.title.trim();
    if (!title) {
      window.alert("Please add an assessment title.");
      return;
    }
    const cleaned: Assessment = { ...draft, title, updatedAt: Date.now() };
    setState((prev) => {
      const exists = prev.assessments.some((a) => a.id === cleaned.id);
      const assessments = exists
        ? prev.assessments.map((a) => (a.id === cleaned.id ? cleaned : a))
        : prev.assessments.concat(cleaned);
      return { ...prev, assessments };
    });
    setEditing(null);
  }

  function remove(id: string) {
    const ok = window.confirm(
      "Delete this assessment and its items, keys, and results?",
    );
    if (!ok) return;
    setState((prev) => cascadeDelete(prev, id));
    if (activeId === id) setActiveId(null);
  }

  if (editing) {
    return (
      <AssessmentEditor
        draft={editing}
        onCancel={() => setEditing(null)}
        onSave={save}
      />
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">Assessment Setup</h1>
          <p className="mt-1 text-slate-500">
            Create an assessment, then set it active to work on it in other tabs.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={loadDemo}>⚡ Load demo</Button>
          <Button onClick={startNew}>+ New Assessment</Button>
        </div>
      </div>

      {state.assessments.length === 0 ? (
        <StartGuide
          setState={setState}
          setActiveId={setActiveId}
          onCreate={startNew}
        />
      ) : (
        <div className="mt-4 grid gap-3">
          {state.assessments.map((a) => (
            <AssessmentCard
              key={a.id}
              assessment={a}
              itemCount={state.items.filter((i) => i.assessmentId === a.id).length}
              isActive={activeId === a.id}
              onEdit={() => setEditing(a)}
              onSetActive={() => setActiveId(a.id)}
              onDelete={() => remove(a.id)}
            />
          ))}
        </div>
      )}

      <BackupTools state={state} setState={setState} setActiveId={setActiveId} />
    </section>
  );
}

function AssessmentCard({
  assessment,
  itemCount,
  isActive,
  onEdit,
  onSetActive,
  onDelete,
}: {
  assessment: Assessment;
  itemCount: number;
  isActive: boolean;
  onEdit: () => void;
  onSetActive: () => void;
  onDelete: () => void;
}) {
  const border = isActive ? "border-indigo-600 border-2" : "border-slate-200";
  return (
    <div className={"rounded-xl border bg-white p-4 " + border}>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <div className="text-lg font-extrabold">{assessment.title}</div>
          <div className="mt-1 text-sm text-slate-500">
            {assessment.subject} · Grade {assessment.gradeLevel}-
            {assessment.section} · {assessment.component} · {assessment.term} Term
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Pill>{itemCount} items</Pill>
            <Pill>Versions: {assessment.versions.join(", ")}</Pill>
            <Pill>{assessment.schoolYear}</Pill>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Button variant="small" onClick={onEdit}>
            Edit
          </Button>
          <Button
            variant={isActive ? "primary" : "small"}
            onClick={onSetActive}
          >
            {isActive ? "✓ Active" : "Set Active"}
          </Button>
          <Button variant="smallDanger" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function AssessmentEditor({
  draft,
  onSave,
  onCancel,
}: {
  draft: Assessment;
  onSave: (a: Assessment) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Assessment>(draft);

  function patch(changes: Partial<Assessment>) {
    setForm((prev) => ({ ...prev, ...changes }));
  }

  function toggleVersion(v: TestVersion) {
    setForm((prev) => {
      const has = prev.versions.includes(v);
      const next = has
        ? prev.versions.filter((x) => x !== v)
        : prev.versions.concat(v);
      // Always keep at least one version selected.
      if (next.length === 0) return prev;
      next.sort();
      return { ...prev, versions: next };
    });
  }

  const isNew = draft.title.trim() === "";

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold">
          {isNew ? "New Assessment" : "Edit Assessment"}
        </h1>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSave(form)}>Save</Button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Assessment Title">
            <TextInput
              value={form.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="e.g. Quiz 1 — Functions"
            />
          </Field>
          <Field label="Subject">
            <TextInput
              value={form.subject}
              onChange={(e) => patch({ subject: e.target.value })}
              placeholder="General Mathematics"
            />
          </Field>
          <Field label="Grade Level">
            <Select
              value={form.gradeLevel}
              onChange={(e) => patch({ gradeLevel: e.target.value })}
            >
              {GRADE_LEVELS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Section">
            <TextInput
              value={form.section}
              onChange={(e) => patch({ section: e.target.value })}
              placeholder="STEM-A"
            />
          </Field>
          <Field label="School Year">
            <TextInput
              value={form.schoolYear}
              onChange={(e) => patch({ schoolYear: e.target.value })}
            />
          </Field>
          <Field label="Term">
            <Select
              value={form.term}
              onChange={(e) => patch({ term: e.target.value as Term })}
            >
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assessment Component">
            <Select
              value={form.component}
              onChange={(e) =>
                patch({ component: e.target.value as AssessmentComponent })
              }
            >
              {ASSESSMENT_COMPONENTS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Teacher Name">
            <TextInput
              value={form.teacherName}
              onChange={(e) => patch({ teacherName: e.target.value })}
            />
          </Field>
        </div>

        <div className="mt-3">
          <span className="mb-1 block text-xs font-bold text-slate-500">
            Test Versions (A–D)
          </span>
          <div className="flex gap-2">
            {TEST_VERSIONS.map((v) => {
              const on = form.versions.includes(v);
              const cls = on
                ? "border-indigo-700 bg-indigo-700 text-white"
                : "border-slate-200 bg-white text-slate-500";
              return (
                <button
                  key={v}
                  onClick={() => toggleVersion(v)}
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
    </section>
  );
}
