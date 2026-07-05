// SmartScan panel — scan → verify → review → save pipeline.
// Batch mode: clean, high-confidence scans save automatically; doubtful scans
// are stored as "needs review" for the Review tab. Manual checking and QR
// paste remain as fallbacks. Results are self-contained: scored under the
// QR's OWN assessment, never whatever happens to be active.

import { useState } from "react";
import type { PanelProps } from "./panel-types";
import type {
  Assessment,
  Item,
  QrAssessmentState,
  Result,
  ReviewStatus,
  TestVersion,
  VersionKey,
} from "../lib/types";
import { isObjective } from "../lib/items";
import { emptyInput, type CheckingInput } from "../lib/scoring";
import { parseQrPayload } from "../lib/qr-parse";
import { saveEvidence } from "../lib/offline-store";
import { ActiveGate } from "./ActiveGate";
import { omrItemsOf } from "../lib/scanner/omr-template";
import type { ReviewSummary } from "../lib/scanner/omr-score";
import { upsertScanResult } from "../lib/scanner/scan-save";
import { AnswerSheetScanner, type ScanResult } from "./scanner/AnswerSheetScanner";
import { ScanReviewPanel } from "./scanner/ScanReviewPanel";
import { CheckForm } from "./ManualCheck";
import { Button, Empty } from "./ui";

type CheckMode = "scan" | "manual" | "paste";

// Auto-accept threshold: at or above this trust score (and with no unclear or
// multiple marks) a batch scan saves without review.
const AUTO_ACCEPT = 0.8;

interface ScanLogEntry {
  id: number;
  name: string;
  text: string;
  tone: "ok" | "warn" | "err";
}

export default function CheckPanel(props: PanelProps) {
  const { state, setState, activeId, setActiveId } = props;
  return (
    <ActiveGate
      assessments={state.assessments}
      activeId={activeId}
      setActiveId={setActiveId}
      title="SmartScan"
    >
      {(active) => (
        <CheckEditor active={active} state={state} setState={setState} setActiveId={setActiveId} />
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
}: {
  active: Assessment;
  state: QrAssessmentState;
  setState: PanelProps["setState"];
  setActiveId: PanelProps["setActiveId"];
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
    return { raw: saved.raw, total: saved.total, pct: saved.pct };
  }

  // Route a completed scan: batch mode auto-saves clean scans and queues
  // doubtful ones; otherwise (or on duplicates) open the review panel.
  function handleScanResult(r: ScanResult) {
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
