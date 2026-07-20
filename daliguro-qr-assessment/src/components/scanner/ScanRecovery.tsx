// Recovery card shown when the QR decoded but identity didn't resolve, plus
// the small live-status Chip. Extracted from AnswerSheetScanner so the
// scanner file stays focused on the capture pipeline.
// It never says "rejected": the QR was read; the data just isn't loaded/active.

import { useState } from "react";
import type { QrAssessmentState } from "../../lib/types";
import type { ScanResolution } from "../../lib/scanner/resolve";
import { resolveScanIdentity } from "../../lib/scanner/resolve";
import type { PreservedSheet } from "../../lib/scanner/still-pipeline";
import { Button, Select, TextInput } from "../ui";

export function Chip({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <span className={"rounded-full px-2.5 py-1 " + (ok ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500")}>
      {ok ? okText : badText}
    </span>
  );
}

// Shown when the QR never decoded but the sheet itself read cleanly: the
// answers are preserved, and the teacher explicitly identifies the learner
// (or types the printed sheet code into the paste box). Identity is a manual,
// attributable decision here — the scanner never guesses it.
export function PreservedRecovery({
  preserved,
  state,
  onIdentify,
  onDismiss,
}: {
  preserved: PreservedSheet;
  state: QrAssessmentState;
  onIdentify: (learnerId: string) => void;
  onDismiss: () => void;
}) {
  const [learnerId, setLearnerId] = useState("");
  const [learnerQuery, setLearnerQuery] = useState("");
  const [showAllLearners, setShowAllLearners] = useState(false);
  const [sheetCode, setSheetCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const answered = preserved.reading.items.filter((i) => i.status === "selected").length;
  const needsReview = preserved.reading.items.length - answered;
  const assessment = state.assessments.find((a) => a.id === preserved.assessmentId);
  const matchingCohort = assessment
    ? state.learners.filter((learner) =>
        learner.gradeLevel === assessment.gradeLevel && learner.section === assessment.section)
    : [];
  const allLearners = [...state.learners]
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const useAllLearners = showAllLearners || matchingCohort.length === 0;
  const query = learnerQuery.trim().toLocaleLowerCase();
  const learners = (useAllLearners ? allLearners : matchingCohort)
    .filter((learner) =>
      query === "" ||
      learner.fullName.toLocaleLowerCase().includes(query) ||
      learner.lrn.toLocaleLowerCase().includes(query) ||
      learner.section.toLocaleLowerCase().includes(query) ||
      learner.gradeLevel.toLocaleLowerCase().includes(query))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const hasLearnersOutsideCohort = matchingCohort.length < state.learners.length;

  function applySheetCode() {
    const resolution = resolveScanIdentity(sheetCode, state, preserved.assessmentId);
    if (resolution.status !== "READY") {
      setCodeError(resolution.status === "QR_PAYLOAD_INVALID" ? resolution.reason : "This code does not match loaded learner data.");
      return;
    }
    if (
      resolution.assessment.id !== preserved.assessmentId ||
      resolution.version !== preserved.version ||
      resolution.payload.n !== preserved.reading.items.length
    ) {
      setCodeError("This code is for a different sheet, version, or item count.");
      return;
    }
    setCodeError("");
    onIdentify(resolution.learner.id);
  }
  return (
    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <div className="font-extrabold">✓ Answers captured — QR unreadable</div>
      <p className="mt-1 text-xs">
        The sheet image was read and preserved (version {preserved.version}, {answered} selected,
        {" "}{needsReview} needing review). Identify the learner from the paper, or enter the exact
        code printed under its QR. The result still goes through normal review before saving.
      </p>
      {assessment ? <p className="mt-1 text-xs font-bold">{assessment.title} · {assessment.gradeLevel} · {assessment.section}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TextInput
          value={learnerQuery}
          onChange={(event) => setLearnerQuery(event.target.value)}
          className="min-w-56 max-w-80"
          aria-label={useAllLearners ? "Search all learners" : "Search matching learners"}
          placeholder={useAllLearners ? "Search all learners…" : "Search this grade and section…"}
        />
        {hasLearnersOutsideCohort ? (
          <Button
            variant="ghost"
            aria-expanded={useAllLearners}
            onClick={() => {
              setShowAllLearners((current) => !current);
              setLearnerId("");
              setLearnerQuery("");
            }}
          >
            {useAllLearners ? "Show matching grade & section" : `Search all learners (${state.learners.length})`}
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-amber-800">
        {useAllLearners
          ? `Showing all loaded learners (${learners.length} match${learners.length === 1 ? "" : "es"}). Confirm the printed name and LRN before continuing.`
          : `Prioritized ${assessment?.gradeLevel ?? "assessment"} · ${assessment?.section ?? "cohort"} learners (${matchingCohort.length}).`}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select
          value={learnerId}
          onChange={(event) => setLearnerId(event.target.value)}
          className="max-w-64"
          aria-label="Learner on this sheet"
        >
          <option value="">Select the learner on this sheet…</option>
          {learners.map((l) => (
            <option key={l.id} value={l.id}>
              {l.fullName} {l.lrn ? `(${l.lrn})` : ""}
            </option>
          ))}
          {learners.length === 0 ? <option disabled>No learners match this search</option> : null}
        </Select>
        <Button variant="small" disabled={!learnerId} onClick={() => onIdentify(learnerId)}>
          Use these answers
        </Button>
        <Button variant="ghost" onClick={onDismiss}>Discard &amp; rescan</Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-amber-200 pt-3">
        <TextInput
          value={sheetCode}
          onChange={(event) => setSheetCode(event.target.value)}
          className="min-w-64 flex-1 font-mono text-xs"
          aria-label="Code printed under the unreadable QR"
          placeholder="DG3|…"
        />
        <Button variant="small" disabled={!sheetCode.trim()} onClick={applySheetCode}>Use sheet code</Button>
      </div>
      {codeError ? <p className="mt-1 text-xs font-bold text-red-700" role="alert">{codeError}</p> : null}
    </div>
  );
}

export function Recovery({
  resolution,
  state,
  onSwitchActive,
  onDismiss,
}: {
  resolution: ScanResolution;
  state: QrAssessmentState;
  onSwitchActive: (id: string) => void;
  onDismiss: () => void;
}) {
  const r = resolution;
  const [showTech, setShowTech] = useState(false);

  let title = "QR read successfully — can't continue yet";
  let body = "";
  if (r.status === "QR_PAYLOAD_INVALID") {
    title = "This isn't a DALIguro answer-sheet QR";
    body = r.reason;
  } else if (r.status === "ASSESSMENT_NOT_FOUND") {
    title = "QR read — this assessment isn't on this device";
    body =
      "The sheet's assessment isn't loaded in this browser. On this device, import the same backup (Setup → Import/restore) or tap ⚡ Load demo if this is the demo, then scan again. Opening the same web link does NOT copy data between devices.";
  } else if (r.status === "LEARNER_NOT_FOUND") {
    title = "QR read — learner not loaded on this device";
    body =
      "The assessment is here, but the learner on the sheet isn't. Reprint sheets from this device's data, import the matching backup, or use SmartScan → Manual checking with an explicit learner selection.";
  } else if (r.status === "ASSESSMENT_NOT_ACTIVE") {
    title = "QR read — switch to its assessment";
    body = "This sheet is for an assessment that's loaded but not active.";
  }

  return (
    <div className="mt-2 rounded-lg border border-indigo-300 bg-indigo-50 p-3 text-sm text-indigo-900">
      <div className="font-extrabold">✓ {title}</div>
      <p className="mt-1 text-xs">{body}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {r.status === "ASSESSMENT_NOT_ACTIVE" ? (
          <Button variant="small" onClick={() => onSwitchActive(r.assessment.id)}>
            Switch to “{r.assessment.title}” &amp; read
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onDismiss}>Scan another</Button>
      </div>

      <button className="mt-2 text-xs font-bold text-indigo-700" onClick={() => setShowTech((s) => !s)}>
        {showTech ? "Hide" : "Show"} technical details
      </button>
      {showTech && r.status !== "QR_PAYLOAD_INVALID" ? (
        <div className="mt-1 rounded bg-white/70 p-2 font-mono text-[11px] text-slate-600">
          <div>scanned assessmentId: {r.payload.assessmentId}</div>
          <div>scanned learnerId: {r.payload.learnerId}</div>
          <div>scanned version: {r.payload.version}</div>
          <div>assessments loaded: {state.assessments.length}</div>
          <div>learners loaded: {state.learners.length}</div>
        </div>
      ) : null}
    </div>
  );
}
