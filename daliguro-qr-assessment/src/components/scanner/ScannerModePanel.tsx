// Camera-scanner phase — Scan Mode selector for the Check tab.
// Manual Checking stays the default fallback; QR Payload Paste keeps working
// as-is; Camera QR Scan is the first real camera build. Full Sheet Scan and
// Batch Scan stay as visible "planned" placeholders only.

import { useState } from "react";
import type { Learner } from "../../lib/types";
import type { QrValidationResult } from "../../lib/scanner/qr-payload";
import { CameraQrScanner } from "./CameraQrScanner";

export type ScanMode =
  | "manual"
  | "qr-paste"
  | "camera"
  | "full-sheet-planned"
  | "batch-planned";

const MODES: { id: ScanMode; label: string; live: boolean }[] = [
  { id: "manual", label: "Manual Checking", live: true },
  { id: "qr-paste", label: "QR Payload Paste", live: true },
  { id: "camera", label: "Camera QR Scan", live: true },
  { id: "full-sheet-planned", label: "Full Sheet Scan (planned)", live: false },
  { id: "batch-planned", label: "Batch Scan (planned)", live: false },
];

export function ScannerModePanel({
  activeAssessmentId,
  learners,
  onValidScan,
}: {
  activeAssessmentId: string;
  learners: Learner[];
  onValidScan: (result: Extract<QrValidationResult, { ok: true }>) => void;
}) {
  const [mode, setMode] = useState<ScanMode>("manual");
  const [showFuturePlan, setShowFuturePlan] = useState(false);

  return (
    <div className="mt-4 rounded-xl border border-dashed border-indigo-300 bg-indigo-50 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-indigo-800">
        📷 Scan Mode
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {MODES.map((m) => {
          const on = m.id === mode;
          const cls = on
            ? "border-indigo-700 bg-indigo-700 text-white"
            : m.live
              ? "border-indigo-300 bg-white text-indigo-700"
              : "border-slate-200 bg-slate-50 text-slate-400";
          return (
            <button
              key={m.id}
              onClick={() => m.live && setMode(m.id)}
              disabled={!m.live}
              className={"rounded-lg border px-3 py-1.5 text-xs font-bold " + cls}
            >
              {m.label}
              {!m.live ? " · planned" : ""}
            </button>
          );
        })}
      </div>

      {mode === "camera" ? (
        <CameraQrScanner
          activeAssessmentId={activeAssessmentId}
          learners={learners}
          onValidScan={onValidScan}
        />
      ) : null}

      {mode === "qr-paste" ? (
        <p className="mt-2 text-xs text-indigo-900/70">
          Use the "Paste QR payload" field below to auto-select the learner and
          version.
        </p>
      ) : null}

      {mode === "manual" ? (
        <p className="mt-2 text-xs text-indigo-900/70">
          Select the learner and version manually below. This is the safe
          fallback and always stays available.
        </p>
      ) : null}

      <button
        className="mt-2 text-xs font-bold text-indigo-700"
        onClick={() => setShowFuturePlan((p) => !p)}
      >
        {showFuturePlan ? "Hide" : "Show"} future full-sheet scanning plan
      </button>
      {showFuturePlan && (
        <ol className="mt-2 list-inside list-decimal rounded-lg bg-white p-3 text-xs text-indigo-900/80">
          <li>Phase 2 — capture the answer-sheet image, detect page boundaries and alignment markers, correct rotation, crop the answer area</li>
          <li>Phase 3 — build an OMR layout map: exact x/y position of every bubble and answer zone</li>
          <li>Phase 4 — bubble detection: selected answer, blank, multiple marks, with a confidence score</li>
          <li>Phase 5 — scan review: item number, scanned answer, correct answer, status, confidence, teacher override</li>
          <li>Phase 6 — batch scanning: scan many papers, review flagged items, save results, move to the next learner</li>
        </ol>
      )}
      <p className="mt-2 text-xs text-indigo-900/70">
        Confidence levels (future phases): 90%+ auto-accepted, 70–89% review
        suggested, below 70% needs review. Teacher approval is always required
        before a score is saved.
      </p>
    </div>
  );
}
