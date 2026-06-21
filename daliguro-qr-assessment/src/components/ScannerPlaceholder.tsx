// Phase 11 (+ revisions) — Scan Mode Preparation.
// No camera / OMR yet. Manual selection and QR-payload paste remain the live
// workflow; this lays out the planned scanning path so the UI is scanner-ready.

import { useState } from "react";

const MODES: { label: string; status: string; live: boolean }[] = [
  { label: "Manual Checking", status: "available now", live: true },
  { label: "QR Payload Paste", status: "available now", live: true },
  { label: "Camera QR Scan", status: "coming next", live: false },
  { label: "Bubble OMR Scan", status: "planned", live: false },
];

export function ScannerPlaceholder() {
  const [showPlan, setShowPlan] = useState(false);

  return (
    <div className="mt-4 rounded-xl border border-dashed border-indigo-300 bg-indigo-50 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-indigo-800">
        📷 Scan Mode Preparation
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {MODES.map((m) => (
          <div
            key={m.label}
            className={
              "flex items-center justify-between rounded-lg border px-3 py-2 text-sm " +
              (m.live
                ? "border-indigo-300 bg-white"
                : "border-slate-200 bg-slate-50 text-slate-500")
            }
          >
            <span className="font-semibold">{m.label}</span>
            <span
              className={
                "rounded-full px-2 py-0.5 text-xs font-bold " +
                (m.live
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-200 text-slate-600")
              }
            >
              {m.status}
            </span>
          </div>
        ))}
      </div>

      <button
        className="mt-2 text-xs font-bold text-indigo-700"
        onClick={() => setShowPlan((p) => !p)}
      >
        {showPlan ? "Hide" : "Show"} planned camera-scan workflow
      </button>
      {showPlan && (
        <ol className="mt-2 list-inside list-decimal rounded-lg bg-white p-3 text-xs text-indigo-900/80">
          <li>open the phone camera (with permission handling)</li>
          <li>scan the QR to identify the learner and assessment</li>
          <li>capture the answer-sheet image</li>
          <li>detect the answer boxes / bubbles</li>
          <li>extract the marked answers</li>
          <li>show the teacher a review screen for flagged items</li>
          <li>save the score</li>
        </ol>
      )}
      <p className="mt-2 text-xs text-indigo-900/70">
        For now, use QR payload paste or manual learner selection below. No
        camera or OMR is wired up yet — checking stays assisted and stable.
      </p>
    </div>
  );
}
