// SmartScan panel — scan → verify → review → save pipeline.
// Batch mode: clean, high-confidence scans save automatically; doubtful scans
// are stored as "needs review" for the Review tab. Manual checking and QR
// paste remain as fallbacks. Results are self-contained: scored under the
// QR's OWN assessment, never whatever happens to be active.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PanelProps } from "./panel-types";
import type {
  Assessment,
  Item,
  QrAssessmentState,
  Result,
  ReviewStatus,
  ScanItemMeta,
  TestVersion,
  VersionKey,
} from "../lib/types";
import { isObjective } from "../lib/items";
import { emptyInput, type CheckingInput } from "../lib/scoring";
import { parseQrPayload } from "../lib/qr-parse";
import { saveEvidence } from "../lib/offline-store";
import { ActiveGate } from "./ActiveGate";
import { omrItemsOf } from "../lib/scanner/omr-template";
import {
  CALIBRATION_EXPECTED,
  certificationGuidance,
  evaluateCertification,
  type CertificationReport,
} from "../lib/scanner/calibration";
import { REVIEW_CONFIDENCE } from "../lib/scanner/omr-score";
import type { ReviewSummary } from "../lib/scanner/omr-score";
import { upsertScanResult, upsertSyncedResult, type SyncedResultInput } from "../lib/scanner/scan-save";
import type { CheckedResultRow, ScoredSummary } from "../lib/sync/pairing";
import { AnswerSheetScanner, type ScanResult } from "./scanner/AnswerSheetScanner";
import { ScanReviewPanel } from "./scanner/ScanReviewPanel";
import { UsePhoneScannerPanel } from "./smartscan/UsePhoneScannerPanel";
import { CheckForm } from "./ManualCheck";
import { Button, Empty } from "./ui";

type CheckMode = "scan" | "manual" | "paste";

// Auto-accept threshold: at or above this trust score (and with no unclear or
// multiple marks) a batch scan saves without review.
const AUTO_ACCEPT = 0.8;
const MIN_PRODUCTION_QUALITY = 55;
const calibrationKey = (assessmentId: string) => `daliguro_scanner_certification_${assessmentId}`;

interface ScanLogEntry {
  id: number;
  name: string;
  text: string;
  tone: "ok" | "warn" | "err";
}

interface SavedScanNotice {
  id: number;
  learnerName: string;
  raw: number;
  total: number;
  pct: number;
  reviewStatus: ReviewStatus;
  confidence: number | null;
  quality?: number | null;
  qualityIssues?: string[];
  version: string;
  source: "scanner" | "phone";
}

export default function CheckPanel(props: PanelProps) {
  const { state, setState, activeId, setActiveId, navigate } = props;
  return (
    <ActiveGate
      assessments={state.assessments}
      activeId={activeId}
      setActiveId={setActiveId}
      title="SmartScan"
    >
      {(active) => (
        <CheckEditor
          key={active.id}
          active={active}
          state={state}
          setState={setState}
          setActiveId={setActiveId}
          navigate={navigate}
        />
      )}
    </ActiveGate>
  );
}

function findResult(
  results: Result[],
  assessmentId: string,
  learnerId: string,
  version: TestVersion,
): Result | undefined {
  return results.find(
    (r) =>
      r.assessmentId === assessmentId &&
      r.learnerId === learnerId &&
      r.version === version,
  );
}

// Rebuild teacher inputs from a previously saved result (for review/override).
function inputFromResult(result: Result | undefined): CheckingInput {
  const input = emptyInput();
  if (!result) return input;
  result.answers.forEach((a) => {
    input.responses[a.itemId] = a.response;
  });
  result.itemScores.forEach((s) => {
    if (s.manual) input.manualScores[s.itemId] = s.awarded;
    if (s.overridden) input.overrides[s.itemId] = s.awarded;
    if (s.remarks) input.remarks[s.itemId] = s.remarks;
  });
  return input;
}

function responsesFrom(summary: ReviewSummary): Record<string, string> {
  const responses: Record<string, string> = {};
  summary.rows.forEach((r) => {
    responses[r.item.id] = r.detected ?? "";
  });
  return responses;
}

// The phone's raw detection shape stored in a synced row's item_results.
type SyncedDetection = { item: number; answer: string; status: string; confidence: number; fill?: number[] };

// Convert a phone-synced checked-result row into the primitives the local
// scorer needs. Answers arrive keyed by item NUMBER; map them to itemIds via
// the assessment's ordered items. Returns null for a row that isn't for this
// assessment. Version comes from the QR (carried in qr_payload), falling back
// to the assessment's first version.
function rowToSyncedInput(
  row: CheckedResultRow,
  active: Assessment,
  aItems: Item[],
  forceReview = false,
): SyncedResultInput | null {
  if (row.assessment_id !== active.id) return null;
  const rv = (row.qr_payload as { version?: string } | null)?.version;
  const version = rv && active.versions.includes(rv as TestVersion) ? rv : active.versions[0] ?? "A";
  const responses: Record<string, string> = {};
  Object.entries(row.answer_map ?? {}).forEach(([num, letter]) => {
    const it = aItems[Number(num) - 1];
    if (it) responses[it.id] = String(letter ?? "");
  });
  const scanItems: ScanItemMeta[] = ((row.item_results as SyncedDetection[]) ?? []).map((d) => ({
    itemNumber: Number(d.item),
    detected: d.answer ? String(d.answer) : null,
    status: (d.status ?? "selected") as ScanItemMeta["status"],
    confidence: Number(d.confidence ?? 0),
    fill: Array.isArray(d.fill) ? d.fill : undefined,
  }));
  // Item-count guard: a scan whose detected item count doesn't match the
  // assessment (stale/wrong-format sheet) must NOT auto-finalize — route it to
  // review so no silently-misaligned result slips through.
  const detectedCount = row.total_items || Object.keys(row.answer_map ?? {}).length;
  const countMismatch = aItems.length > 0 && detectedCount !== aItems.length;
  const hasDoubt =
    (row.low_confidence_items?.length ?? 0) > 0 ||
    scanItems.some((s) => s.status === "unclear" || s.status === "multiple" || (s.status === "selected" && s.confidence < REVIEW_CONFIDENCE));
  const trust = Number(row.scan_confidence ?? 0);
  const reviewStatus: ReviewStatus = forceReview || countMismatch || hasDoubt || trust < AUTO_ACCEPT ? "needs_review" : "auto";
  return { assessmentId: active.id, learnerId: row.learner_id, version, responses, scanItems, confidence: row.scan_confidence, reviewStatus };
}

function trustTone(confidence: number): string {
  if (confidence >= AUTO_ACCEPT) return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (confidence >= 0.6) return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-red-300 bg-red-50 text-red-700";
}

function CheckEditor({
  active,
  state,
  setState,
  setActiveId,
  navigate,
}: {
  active: Assessment;
  state: QrAssessmentState;
  setState: PanelProps["setState"];
  setActiveId: PanelProps["setActiveId"];
  navigate?: PanelProps["navigate"];
}) {
  const items: Item[] = state.items
    .filter((i) => i.assessmentId === active.id)
    .sort((a, b) => a.itemNumber - b.itemNumber);

  const [learnerId, setLearnerId] = useState("");
  const [version, setVersion] = useState<TestVersion>(active.versions[0] ?? "A");
  const [dirty, setDirty] = useState(false);
  const [qrText, setQrTextValue] = useState("");
  const [mode, setMode] = useState<CheckMode>("scan");
  const [scanFeedback, setScanFeedback] = useState("");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [batch, setBatch] = useState(true);
  const [scanLog, setScanLog] = useState<ScanLogEntry[]>([]);
  const [lastSaved, setLastSaved] = useState<SavedScanNotice | null>(null);
  const [calibrationMode, setCalibrationMode] = useState(false);
  const [certification, setCertification] = useState<CertificationReport | null>(() => {
    try {
      const raw = localStorage.getItem(calibrationKey(active.id));
      return raw ? JSON.parse(raw) as CertificationReport : null;
    } catch {
      return null;
    }
  });
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  function saveCertification(report: CertificationReport) {
    setCertification(report);
    try {
      localStorage.setItem(calibrationKey(active.id), JSON.stringify(report));
    } catch {
      /* local certification is a UI gate; storage failure should not crash scanning */
    }
  }

  function log(name: string, text: string, tone: ScanLogEntry["tone"]) {
    setScanLog((prev) => [{ id: Date.now() + Math.random(), name, text, tone }, ...prev].slice(0, 12));
  }

  // Persist a scan under the SCANNED assessment (from the QR), not whatever is
  // active. Returns null when a finalized result blocked the save.
  function persistScan(
    result: ScanResult,
    responses: Record<string, string>,
    reviewStatus: ReviewStatus,
  ): { raw: number; total: number; pct: number } | null {
    const existing = findResult(
      state.results,
      result.assessment.id,
      result.learner.id,
      result.version,
    );
    let auditReason: string | undefined;
    if (existing?.finalizedAt) {
      const reason = window.prompt(
        "This result is FINALIZED (locked). Enter a reason to replace it, or Cancel:",
      );
      if (!reason || !reason.trim()) return null;
      auditReason = reason.trim();
    }
    const saved = upsertScanResult(state, result, responses, reviewStatus, auditReason);
    setState((prev) => {
      // Recompute against the freshest state so batch saves never clobber.
      const next = upsertScanResult(prev, result, responses, reviewStatus, auditReason);
      return { ...prev, results: next.results };
    });
    if (result.evidence) void saveEvidence(saved.id, result.evidence);
    setLastSaved({
      id: Date.now(),
      learnerName: result.learner.fullName,
      raw: saved.raw,
      total: saved.total,
      pct: saved.pct,
      reviewStatus,
      confidence: result.confidence,
      quality: result.quality?.score ?? null,
      qualityIssues: result.quality?.issues ?? [],
      version: result.version,
      source: "scanner",
    });
    return { raw: saved.raw, total: saved.total, pct: saved.pct };
  }

  // Route a completed scan: batch mode auto-saves clean scans and queues
  // doubtful ones; otherwise (or on duplicates) open the review panel.
  function handleScanResult(r: ScanResult) {
    if (calibrationMode || !certification || certification.verdict === "Failed") {
      const report = evaluateCertification(r);
      saveCertification(report);
      setCalibrationMode(false);
      setScanResult(null);
      log(
        "Scanner Certification",
        `${report.verdict} · ${report.score}/100 · ${report.status}`,
        report.verdict === "Passed" ? "ok" : report.verdict === "Conditional Pass" ? "warn" : "err",
      );
      return;
    }
    if (r.quality.label === "Retake" || r.quality.score < MIN_PRODUCTION_QUALITY) {
      setScanFeedback(
        `Rescan required: capture quality ${r.quality.score}/100 (${r.quality.issues.join(", ") || "not reliable"}).`,
      );
      log(r.learner.fullName, `rescan required · quality ${r.quality.score}/100`, "err");
      return;
    }
    const existing = findResult(state.results, r.assessment.id, r.learner.id, r.version);
    if (!batch || existing) {
      setScanResult(r);
      return;
    }
    const responses = responsesFrom(r.summary);
    if (r.summary.needsReview || r.confidence < AUTO_ACCEPT) {
      const saved = persistScan(r, responses, "needs_review");
      if (saved) {
        log(
          r.learner.fullName,
          `→ Review queue (trust ${Math.round(r.confidence * 100)}%, ` +
            `${r.summary.unclearCount + r.summary.multipleCount} doubtful item(s))`,
          "warn",
        );
      }
    } else {
      const saved = persistScan(r, responses, "auto");
      if (saved) {
        log(r.learner.fullName, `${saved.raw}/${saved.total} (${saved.pct}%) · auto-accepted`, "ok");
      }
    }
  }

  function saveReviewedScan(result: ScanResult, responses: Record<string, string>) {
    const saved = persistScan(result, responses, "reviewed");
    if (!saved) return;
    setScanResult(null);
    log(result.learner.fullName, `${saved.raw}/${saved.total} (${saved.pct}%) · reviewed & saved`, "ok");
    if (!batch) {
      window.alert(
        "Saved " + result.learner.fullName + ": " + saved.raw + "/" + saved.total + " (" + saved.pct + "%)",
      );
    }
  }

  // Merge checked-result rows synced from a paired phone into local state. The
  // phone sends raw detected answers; we score them against THIS device's answer
  // key so they flow into Results / Review / Analysis exactly like a PC scan.
  const handleSyncedRows = useCallback(
    (rows: CheckedResultRow[]): ScoredSummary[] => {
      if (rows.length === 0) return [];
      const current = stateRef.current;
      const aItems = current.items
        .filter((i) => i.assessmentId === active.id)
        .sort((a, b) => a.itemNumber - b.itemNumber);
      // Score each row against the current answer key (pure) for the phone reply.
      const scored: ScoredSummary[] = [];
      const confirmations: SavedScanNotice[] = [];
      const forceReview = !certification || certification.verdict === "Failed";
      for (const row of rows) {
        const input = rowToSyncedInput(row, active, aItems, forceReview);
        if (!input) continue;
        const outcome = upsertSyncedResult(current, input);
        const r = outcome.results.find(
          (x) => x.assessmentId === active.id && x.learnerId === input.learnerId && x.version === input.version,
        );
        if (!r) continue;
        const correct = r.itemScores.filter((s) => s.correct).length;
        const blank = r.itemScores.filter((s) => s.blank).length;
        const wrong = Math.max(0, r.itemScores.length - correct - blank);
        scored.push({ learnerId: r.learnerId, raw: outcome.raw, total: outcome.total, pct: outcome.pct, correct, wrong, blank, mastery: r.masteryStatus });
        confirmations.push({
          id: Date.now() + Math.random(),
          learnerName:
            row.learner_name ||
            current.learners.find((learnerRow) => learnerRow.id === input.learnerId)?.fullName ||
            input.learnerId,
          raw: outcome.raw,
          total: outcome.total,
          pct: outcome.pct,
          reviewStatus: input.reviewStatus,
          confidence: input.confidence,
          quality: input.confidence == null ? null : Math.round(input.confidence * 100),
          qualityIssues: forceReview
            ? ["scanner certification required"]
            : input.reviewStatus === "needs_review"
              ? ["needs teacher review"]
              : [],
          version: input.version,
          source: "phone",
        });
      }
      // Merge into live state (recompute against freshest state so batch scans
      // never clobber each other).
      setState((prev) => {
        const pItems = prev.items
          .filter((i) => i.assessmentId === active.id)
          .sort((a, b) => a.itemNumber - b.itemNumber);
        let next = prev;
        const mustReview = !certification || certification.verdict === "Failed";
        for (const row of rows) {
          const input = rowToSyncedInput(row, active, pItems, mustReview);
          if (input) next = { ...next, results: upsertSyncedResult(next, input).results };
        }
        return next;
      });
      const latest = confirmations[confirmations.length - 1];
      if (latest) {
        setLastSaved(latest);
        log(
          latest.learnerName,
          `${latest.raw}/${latest.total} (${latest.pct}%) · submitted from phone`,
          latest.reviewStatus === "needs_review" ? "warn" : "ok",
        );
      }
      return scored;
    },
    [active, certification, setState],
  );

  const activeVersion = active.versions.includes(version)
    ? version
    : active.versions[0] ?? "A";

  if (items.length === 0) {
    return (
      <Wrap title="SmartScan" subtitle={active.title}>
        <Empty text="This assessment has no items. Add items first." />
      </Wrap>
    );
  }
  if (state.learners.length === 0) {
    return (
      <Wrap title="SmartScan" subtitle={active.title}>
        <Empty text="No learners yet. Add learners first." />
      </Wrap>
    );
  }

  const versionKey: VersionKey =
    (state.answerKeys[active.id] ?? {})[activeVersion] ?? {};
  const learner = state.learners.find((l) => l.id === learnerId);

  // Switch learner/version, guarding against losing unsaved edits.
  function switchSelection(next: () => void) {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setDirty(false);
    next();
  }

  // Validate a pasted QR string and, if valid, select its learner + version.
  function acceptQr(text: string): boolean {
    const res = parseQrPayload(text, {
      activeAssessmentId: active.id,
      hasLearner: (id) => state.learners.some((l) => l.id === id),
      versions: active.versions,
    });
    if (!res.ok) {
      setScanFeedback("✗ " + res.reason);
      return false;
    }
    const { payload } = res;
    const target = state.learners.find((l) => l.id === payload.learnerId);
    switchSelection(() => {
      setLearnerId(payload.learnerId);
      setVersion(payload.version);
      setQrTextValue("");
      setScanFeedback(
        "✓ Selected " +
          (target ? target.fullName : payload.learnerId) +
          " · version " +
          payload.version,
      );
    });
    return true;
  }

  function applyQr() {
    if (!qrText.trim()) return;
    acceptQr(qrText);
  }

  const existing = findResult(state.results, active.id, learnerId, activeVersion);
  const initialInput = inputFromResult(existing);
  const pendingCount = state.results.filter(
    (r) => r.assessmentId === active.id && r.reviewStatus === "needs_review",
  ).length;

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">SmartScan</h1>
          <p className="mt-1 text-slate-500">
            {active.title} · {items.length} item(s) · scan once, check instantly, review only what matters
          </p>
        </div>
      </div>

      {/* Identify mode */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-slate-500">Check by:</span>
        {(
          [
            ["scan", "🗒️ SmartScan"],
            ["manual", "✍ Manual (fallback)"],
            ["paste", "📋 QR Paste (diagnostic)"],
          ] as [CheckMode, string][]
        ).map(([m, label]) => {
          const on = mode === m;
          const cls = on
            ? "border-indigo-700 bg-indigo-700 text-white"
            : "border-slate-200 bg-white text-slate-600";
          return (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setScanFeedback("");
              }}
              className={"rounded-lg border px-3 py-1.5 text-sm font-bold " + cls}
            >
              {label}
            </button>
          );
        })}
        {mode === "scan" ? (
          <label className="ml-auto flex items-center gap-2 text-xs font-bold text-slate-600">
            <input type="checkbox" checked={batch} onChange={(e) => setBatch(e.target.checked)} />
            Batch mode: auto-save clean scans
          </label>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {mode === "scan"
          ? batch
            ? "Batch: scan sheet after sheet. High-confidence scans save automatically; doubtful ones go to the Review tab. Duplicates always open for confirmation."
            : "Single: each scan opens for review before saving."
          : mode === "manual"
            ? "Manual (fallback): choose the learner and version below, then mark answers by hand."
            : "QR Paste (diagnostic): paste a copied QR payload below to auto-select the learner and version."}
      </p>

      {mode === "scan" ? (
        scanResult ? (
          <>
            <div className={"mt-4 rounded-lg border p-2 text-sm font-bold " + trustTone(scanResult.confidence)}>
              Scan Accuracy Confidence: {Math.round(scanResult.confidence * 100)}% ·{" "}
              {scanResult.summary.needsReview || scanResult.confidence < AUTO_ACCEPT
                ? "Needs review — confirm the flagged items below"
                : "High confidence — verify and save"}
            </div>
            <ScanQualityCard
              score={scanResult.quality.score}
              label={scanResult.quality.label}
              issues={scanResult.quality.issues}
            />
            <ScanReviewPanel
              learner={scanResult.learner}
              version={scanResult.version}
              assessmentTitle={scanResult.assessment.title}
              omrItems={omrItemsOf(
                state.items.filter((i) => i.assessmentId === scanResult.assessment.id),
              )}
              versionKey={
                (state.answerKeys[scanResult.assessment.id] ?? {})[scanResult.version] ?? {}
              }
              readings={scanResult.reading.items}
              alreadySaved={Boolean(
                findResult(
                  state.results,
                  scanResult.assessment.id,
                  scanResult.learner.id,
                  scanResult.version,
                ),
              )}
              onSave={(_learner, _version, responses) => saveReviewedScan(scanResult, responses)}
              onRescan={() => setScanResult(null)}
            />
          </>
        ) : (
          <>
            <CalibrationPanel
              report={certification}
              activeTitle={active.title}
              calibrationMode={calibrationMode || !certification || certification.verdict === "Failed"}
              onStart={() => {
                setCalibrationMode(true);
                setScanFeedback("Calibration mode active. Scan the calibration sheet with the known pattern shown below.");
              }}
              onReset={() => {
                setCertification(null);
                setCalibrationMode(true);
                try {
                  localStorage.removeItem(calibrationKey(active.id));
                } catch {
                  /* ignore */
                }
              }}
            />
            {scanFeedback ? (
              <div
                className={
                  "mt-3 rounded-lg border p-2 text-sm font-semibold " +
                  (scanFeedback.startsWith("Rescan")
                    ? "border-red-300 bg-red-50 text-red-700"
                    : "border-indigo-200 bg-indigo-50 text-indigo-800")
                }
              >
                {scanFeedback}
              </div>
            ) : null}
            <UsePhoneScannerPanel assessmentId={active.id} onSyncedRows={handleSyncedRows} />
            {lastSaved ? <SubmittedToSystemCard saved={lastSaved} navigate={navigate} /> : null}
            <AnswerSheetScanner
              state={state}
              activeId={active.id}
              onSetActive={setActiveId}
              onResult={handleScanResult}
            />
            {pendingCount > 0 ? (
              <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs font-bold text-amber-800">
                ⏳ {pendingCount} scan(s) waiting in the Review tab.
              </div>
            ) : null}
            {scanLog.length > 0 ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-xs font-bold text-slate-500">Recent scans</div>
                <ul className="mt-1 grid gap-1 text-sm">
                  {scanLog.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{e.name}</span>
                      <span
                        className={
                          e.tone === "ok"
                            ? "text-emerald-700"
                            : e.tone === "warn"
                              ? "text-amber-700"
                              : "text-red-700"
                        }
                      >
                        {e.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )
      ) : null}

      {mode !== "scan" ? (
        <>
          {/* Selection */}
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-500">
                  Learner
                </span>
                <select
                  value={learnerId}
                  onChange={(e) =>
                    switchSelection(() => setLearnerId(e.target.value))
                  }
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">— select learner —</option>
                  {state.learners.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.fullName}
                      {l.section ? " (" + l.section + ")" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div>
                <span className="mb-1 block text-xs font-bold text-slate-500">
                  Version
                </span>
                <div className="flex gap-2">
                  {active.versions.map((v) => {
                    const on = v === activeVersion;
                    const cls = on
                      ? "border-indigo-700 bg-indigo-700 text-white"
                      : "border-slate-200 bg-white text-slate-500";
                    return (
                      <button
                        key={v}
                        onClick={() => switchSelection(() => setVersion(v))}
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

            {/* QR paste (paste mode only) */}
            {mode === "paste" ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className="min-w-60 flex-1">
                  <span className="mb-1 block text-xs font-bold text-slate-500">
                    Paste QR payload to auto-select learner & version
                  </span>
                  <input
                    value={qrText}
                    onChange={(e) => setQrTextValue(e.target.value)}
                    placeholder='{"assessmentId":"…","learnerId":"…","version":"A"}'
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs"
                  />
                </label>
                <Button variant="ghost" onClick={applyQr}>
                  Apply QR
                </Button>
              </div>
            ) : null}

            {scanFeedback ? (
              <div
                className={
                  "mt-3 rounded-lg border p-2 text-sm font-semibold " +
                  (scanFeedback.startsWith("✓")
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                    : "border-red-300 bg-red-50 text-red-700")
                }
              >
                {scanFeedback}
              </div>
            ) : null}

            {Object.keys(versionKey).length === 0 &&
            items.some((i) => isObjective(i.type)) ? (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm text-amber-800">
                ⚠ No answer key set for version {activeVersion}. Set it in the Items
                tab.
              </div>
            ) : null}
          </div>

          {learner ? (
            <CheckForm
              // Remount (and re-init inputs) whenever the selection changes.
              key={learnerId + "|" + activeVersion}
              active={active}
              items={items}
              versionKey={versionKey}
              learner={learner}
              version={activeVersion}
              initialInput={initialInput}
              alreadySaved={Boolean(existing)}
              dirty={dirty}
              onDirty={setDirty}
              setState={setState}
            />
          ) : (
            <Empty text="Select a learner to start checking." />
          )}
        </>
      ) : null}
    </section>
  );
}

function SubmittedToSystemCard({
  saved,
  navigate,
}: {
  saved: SavedScanNotice;
  navigate?: PanelProps["navigate"];
}) {
  const needsReview = saved.reviewStatus === "needs_review";
  const tone = needsReview
    ? "border-amber-300 bg-amber-50 text-amber-900"
    : "border-emerald-300 bg-emerald-50 text-emerald-900";
  const source = saved.source === "phone" ? "phone scanner" : "SmartScan camera";
  return (
    <div className={"mt-4 rounded-xl border p-4 " + tone}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-extrabold">
            {needsReview ? "Submitted to Review Queue" : "Submitted to System"}
          </div>
          <div className="mt-1 text-lg font-black text-slate-950">{saved.learnerName}</div>
          <div className="text-xs font-semibold">
            Version {saved.version} · {source}
            {saved.confidence === null ? "" : ` · ${Math.round(saved.confidence * 100)}% scan confidence`}
            {saved.quality == null ? "" : ` · quality ${saved.quality}/100`}
          </div>
          {saved.qualityIssues && saved.qualityIssues.length > 0 ? (
            <div className="mt-1 text-xs font-bold">
              Check: {saved.qualityIssues.join(", ")}
            </div>
          ) : null}
          <div className="mt-2 text-xs font-bold">
            Reports, Results, Item Analysis, and Remediation now use this saved result.
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-black text-indigo-700">
            {saved.raw}/{saved.total}
          </div>
          <div className="text-sm font-extrabold text-slate-700">{saved.pct}%</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="small" onClick={() => navigate?.("results")}>View Results</Button>
        <Button variant="small" onClick={() => navigate?.("reports")}>View Reports</Button>
        <Button variant="small" onClick={() => navigate?.("item-analysis")}>View Analysis</Button>
        {needsReview ? <Button variant="small" onClick={() => navigate?.("review")}>Open Review Queue</Button> : null}
      </div>
    </div>
  );
}

function CalibrationPanel({
  report,
  activeTitle,
  calibrationMode,
  onStart,
  onReset,
}: {
  report: CertificationReport | null;
  activeTitle: string;
  calibrationMode: boolean;
  onStart: () => void;
  onReset: () => void;
}) {
  const verdict = report?.verdict ?? "Failed";
  const tone =
    report?.verdict === "Passed"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : report?.verdict === "Conditional Pass"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-red-300 bg-red-50 text-red-800";
  return (
    <div className={"mt-4 rounded-xl border p-4 " + tone}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-wide opacity-75">Scanner Calibration and Certification</div>
          <div className="mt-1 text-xl font-black">
            {report ? `${report.verdict} · ${report.score}/100` : "Certification Required"}
          </div>
          <div className="mt-1 text-sm font-bold">{certificationGuidance(report)}</div>
          <div className="mt-1 text-xs font-semibold">
            {activeTitle} · production auto-scoring is {report && report.verdict !== "Failed" ? "available for trusted scans" : "locked until calibration passes"}.
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="small" onClick={onStart}>
            {calibrationMode ? "Calibration Active" : "Scan Calibration"}
          </Button>
          <Button variant="small" onClick={onReset}>Reset Certification</Button>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-white/60 bg-white/70 p-3 text-slate-800">
        <div className="text-xs font-black uppercase tracking-wide text-slate-500">Calibration sheet pattern</div>
        <p className="mt-1 text-xs font-semibold text-slate-600">
          Print or use one normal answer sheet for this assessment. Shade the first {CALIBRATION_EXPECTED.length} items exactly as shown; leave remaining items blank.
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {CALIBRATION_EXPECTED.map((answer, index) => (
            <span key={index} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-black text-slate-700">
              {index + 1}: {answer}
            </span>
          ))}
        </div>
      </div>

      {report ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-lg border border-white/60 bg-white/70 p-3">
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Certification status</div>
            <div className="mt-1 text-lg font-black text-slate-900">{report.status}</div>
            <div className="mt-2 grid gap-1 text-xs font-semibold text-slate-700">
              {report.blockers.length > 0 ? report.blockers.map((b) => <div key={b}>Rescan: {b}</div>) : null}
              {report.warnings.length > 0 ? report.warnings.map((w) => <div key={w}>Check: {w}</div>) : null}
              {report.blockers.length === 0 && report.warnings.length === 0 ? <div>All certification checks passed.</div> : null}
            </div>
          </div>
          <div className="rounded-lg border border-white/60 bg-white/70 p-3">
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">Known answer readback</div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
              {report.read.map((row) => (
                <div key={row.item} className={row.passed ? "font-bold text-emerald-700" : "font-bold text-red-700"}>
                  {row.item}: expected {row.expected}, read {row.detected ?? "blank"} ({Math.round(row.confidence * 100)}%)
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-white/60 bg-white/70 p-3 lg:col-span-2">
            <div className="grid gap-2 md:grid-cols-3">
              {report.metrics.map((metric) => (
                <div key={metric.label} className="rounded-lg border border-slate-200 bg-white p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-slate-600">{metric.label}</span>
                    <span className={metric.ok ? "text-xs font-black text-emerald-700" : "text-xs font-black text-red-700"}>
                      {metric.score}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] font-semibold text-slate-500">{metric.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {!report || verdict === "Failed" || calibrationMode ? (
        <div className="mt-3 rounded-lg border border-white/70 bg-white/70 p-2 text-xs font-bold text-slate-700">
          Real class scanning is locked for trusted auto-scoring until this certification is Passed or Conditional Pass.
        </div>
      ) : null}
    </div>
  );
}

function ScanQualityCard({
  score,
  label,
  issues,
}: {
  score: number;
  label: string;
  issues: string[];
}) {
  const cls =
    score >= 88
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : score >= 74
        ? "border-indigo-300 bg-indigo-50 text-indigo-800"
        : score >= 55
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-red-300 bg-red-50 text-red-700";
  return (
    <div className={"mt-2 rounded-lg border p-3 text-sm " + cls}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-extrabold">Capture Quality: {label}</div>
        <div className="text-lg font-black">{score}/100</div>
      </div>
      <div className="mt-1 text-xs font-semibold">
        {issues.length > 0 ? issues.join(" · ") : "QR, corner targets, focus, and marks are clean."}
      </div>
    </div>
  );
}

function Wrap({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h1 className="text-2xl font-extrabold">{title}</h1>
      <p className="mt-1 text-slate-500">{subtitle}</p>
      {children}
    </section>
  );
}
