// Review tab — the queue of doubtful scans. Shows ONLY results the scanner
// flagged (low trust, unclear or multiple marks). The teacher corrects the
// flagged items from the stored detection snapshot (and the archived scan
// image), then confirms — the result moves to "reviewed".

import { useEffect, useState } from "react";
import type { PanelProps } from "./panel-types";
import type {
  Assessment,
  QrAssessmentState,
  Result,
} from "../lib/types";
import { computeScores, emptyInput } from "../lib/scoring";
import { getEvidence } from "../lib/offline-store";
import { omrItemsOf } from "../lib/scanner/omr-template";
import type { ItemReading } from "../lib/scanner/omr-detect";
import { ActiveGate } from "./ActiveGate";
import { ScanReviewPanel } from "./scanner/ScanReviewPanel";
import { Button, Empty } from "./ui";

export default function ReviewPanel(props: PanelProps) {
  const { state, setState, activeId, setActiveId } = props;
  return (
    <ActiveGate
      assessments={state.assessments}
      activeId={activeId}
      setActiveId={setActiveId}
      title="Review Queue"
    >
      {(active) => <ReviewQueue active={active} state={state} setState={setState} />}
    </ActiveGate>
  );
}

// Rebuild detector readings from the snapshot stored on the result.
function readingsOf(result: Result): ItemReading[] {
  return (result.scanItems ?? []).map((s) => ({
    item: s.itemNumber,
    detected: (s.detected as ItemReading["detected"]) ?? null,
    status: s.status,
    confidence: s.confidence,
    fill: [],
  }));
}

function doubtfulCount(result: Result): number {
  return (result.scanItems ?? []).filter(
    (s) => s.status === "unclear" || s.status === "multiple",
  ).length;
}

// Module-level so the react-hooks purity rule sees the Date.now() call is
// outside component render scope (runs only from the save handler).
function applyCorrection(
  state: QrAssessmentState,
  result: Result,
  responses: Record<string, string>,
): QrAssessmentState {
  const aItems = state.items
    .filter((i) => i.assessmentId === result.assessmentId)
    .sort((x, y) => x.itemNumber - y.itemNumber);
  const vk = (state.answerKeys[result.assessmentId] ?? {})[result.version] ?? {};
  const summary = computeScores(aItems, vk, { ...emptyInput(), responses });
  const answers = aItems.map((i) => ({ itemId: i.id, response: responses[i.id] ?? "" }));
  const now = Date.now();
  return {
    ...state,
    results: state.results.map((r) =>
      r.id === result.id
        ? {
            ...r,
            answers,
            itemScores: summary.itemScores,
            rawScore: summary.rawScore,
            totalScore: summary.totalScore,
            percentage: summary.percentage,
            masteryStatus: summary.masteryStatus,
            reviewed: true,
            reviewStatus: "reviewed" as const,
            auditLog: r.auditLog.concat({ at: now, action: "Reviewed and confirmed" }),
            updatedAt: now,
          }
        : r,
    ),
  };
}

function ReviewQueue({
  active,
  state,
  setState,
}: {
  active: Assessment;
  state: QrAssessmentState;
  setState: PanelProps["setState"];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  const pending = state.results
    .filter((r) => r.assessmentId === active.id && r.reviewStatus === "needs_review")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const open = pending.find((r) => r.id === openId) ?? null;

  function learnerOf(r: Result) {
    return state.learners.find((l) => l.id === r.learnerId);
  }

  // Apply teacher corrections to a queued result and mark it reviewed.
  function saveCorrected(result: Result, responses: Record<string, string>) {
    setState((prev) => applyCorrection(prev, result, responses));
    setOpenId(null);
  }

  if (open) {
    const learner = learnerOf(open);
    const omrItems = omrItemsOf(state.items.filter((i) => i.assessmentId === open.assessmentId));
    if (!learner) {
      return (
        <section>
          <h1 className="text-2xl font-extrabold">Review Queue</h1>
          <Empty text="This learner no longer exists on this device. Delete the result in the Results tab." />
          <Button variant="ghost" onClick={() => setOpenId(null)}>← Back to queue</Button>
        </section>
      );
    }
    return (
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-extrabold">Reviewing scan</h1>
          <Button variant="ghost" onClick={() => setOpenId(null)}>← Back to queue</Button>
        </div>
        <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm font-bold text-amber-800">
          Scan trust {open.scanConfidence !== null ? Math.round(open.scanConfidence * 100) + "%" : "—"} ·{" "}
          {doubtfulCount(open)} doubtful item(s). Set the correct answer for the flagged rows, then save.
        </div>
        <EvidenceImage resultId={open.id} />
        <ScanReviewPanel
          learner={learner}
          version={open.version}
          assessmentTitle={active.title}
          omrItems={omrItems}
          versionKey={(state.answerKeys[open.assessmentId] ?? {})[open.version] ?? {}}
          readings={readingsOf(open)}
          alreadySaved={true}
          onSave={(_l, _v, responses) => saveCorrected(open, responses)}
          onRescan={() => setOpenId(null)}
        />
      </section>
    );
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">Review Queue</h1>
          <p className="mt-1 text-slate-500">
            {active.title} · only doubtful scans land here — everything else saved automatically.
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800">
          {pending.length} pending
        </span>
      </div>

      {pending.length === 0 ? (
        <Empty text="Nothing to review — all scans are clean. 🎉" />
      ) : (
        <div className="mt-4 grid gap-2">
          {pending.map((r) => {
            const learner = learnerOf(r);
            const doubtful = doubtfulCount(r);
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-white p-3"
              >
                <div className="min-w-40">
                  <div className="font-extrabold">{learner ? learner.fullName : "(unknown learner)"}</div>
                  <div className="text-xs text-slate-500">
                    Version {r.version} · scanned {new Date(r.updatedAt).toLocaleString()}
                  </div>
                </div>
                <div className="text-sm">
                  <span className="font-bold text-indigo-700">
                    {r.rawScore}/{r.totalScore}
                  </span>{" "}
                  <span className="text-xs text-slate-500">(provisional)</span>
                </div>
                <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                  {doubtful} doubtful item(s)
                </span>
                {r.scanConfidence !== null ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                    trust {Math.round(r.scanConfidence * 100)}%
                  </span>
                ) : null}
                <div className="ml-auto">
                  <Button variant="small" onClick={() => setOpenId(r.id)}>
                    Review →
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// Archived scan snapshot for the result being reviewed (evidence archive).
function EvidenceImage({ resultId }: { resultId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    let on = true;
    getEvidence(resultId).then((v) => on && setSrc(v));
    return () => {
      on = false;
    };
  }, [resultId]);
  if (!src) return null;
  return (
    <div className="mt-2">
      <button className="text-xs font-bold text-indigo-700" onClick={() => setShow((s) => !s)}>
        {show ? "Hide" : "Show"} scanned sheet image (evidence)
      </button>
      {show ? (
        <img
          src={src}
          alt="Scanned answer sheet evidence"
          className="mt-2 max-h-96 rounded-lg border border-slate-200"
        />
      ) : null}
    </div>
  );
}
