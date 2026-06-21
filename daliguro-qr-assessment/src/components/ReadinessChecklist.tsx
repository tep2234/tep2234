// Issue 10 — Assessment readiness checklist.
// Shows teachers what is done and what to do next for the active assessment.

import type { Assessment, QrAssessmentState } from "../lib/types";
import { isObjective } from "../lib/items";

function keysComplete(state: QrAssessmentState, active: Assessment): boolean {
  const objective = state.items.filter(
    (i) => i.assessmentId === active.id && isObjective(i.type),
  );
  if (objective.length === 0) return false;
  const keys = state.answerKeys[active.id] ?? {};
  return active.versions.every((v) => {
    const versionKey = keys[v] ?? {};
    return objective.every((i) => (versionKey[i.id] ?? "").trim() !== "");
  });
}

export function ReadinessChecklist({
  state,
  active,
}: {
  state: QrAssessmentState;
  active: Assessment | null;
}) {
  const items = active
    ? state.items.filter((i) => i.assessmentId === active.id)
    : [];
  const results = active
    ? state.results.filter((r) => r.assessmentId === active.id)
    : [];

  const steps: { label: string; done: boolean }[] = [
    { label: "Assessment created & active", done: Boolean(active) },
    { label: "Items added", done: items.length > 0 },
    {
      label: "Answer keys complete",
      done: Boolean(active) && keysComplete(state, active!),
    },
    { label: "Learners added", done: state.learners.length > 0 },
    {
      label: "QR sheets ready",
      done: items.length > 0 && state.learners.length > 0,
    },
    {
      label: "Checking ready",
      done:
        Boolean(active) &&
        items.length > 0 &&
        state.learners.length > 0 &&
        keysComplete(state, active!),
    },
    { label: "Results available", done: results.length > 0 },
    { label: "Analysis available", done: results.length > 0 },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">Assessment Readiness</h2>
        <span className="text-xs font-bold text-slate-500">
          {doneCount}/{steps.length}
        </span>
      </div>
      {!active && (
        <p className="mt-1 text-xs text-slate-500">
          Create an assessment and set it active to track readiness.
        </p>
      )}
      <ul className="mt-2 grid gap-1">
        {steps.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <span
              className={
                "flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white " +
                (s.done ? "bg-emerald-600" : "bg-slate-300")
              }
            >
              {s.done ? "✓" : ""}
            </span>
            <span className={s.done ? "text-slate-700" : "text-slate-400"}>
              {s.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
