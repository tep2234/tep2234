// Recovery card shown when the QR decoded but identity didn't resolve, plus
// the small live-status Chip. Extracted from AnswerSheetScanner so the
// scanner file stays focused on the capture pipeline.
// It never says "rejected": the QR was read; the data just isn't loaded/active.

import { useState } from "react";
import type { QrAssessmentState } from "../../lib/types";
import type { ScanResolution } from "../../lib/scanner/resolve";
import { Button } from "../ui";

export function Chip({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <span className={"rounded-full px-2.5 py-1 " + (ok ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500")}>
      {ok ? okText : badText}
    </span>
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
