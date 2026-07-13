import type { QrAssessmentState, Result } from "../types";
import { computeScores, emptyInput } from "../scoring";
import { omrItemsOf } from "./omr-template";
import type { ReviewDecisions } from "./omr-score";
import { resolveScanItemDecisions, scoreExcludingUnresolved } from "./scan-save";

export function applyCorrection(
  state: QrAssessmentState,
  result: Result,
  responses: Record<string, string>,
  actorId: string,
  decisions: ReviewDecisions = {},
  eventIds: Record<number, string> = {},
): QrAssessmentState {
  const assessmentItems = state.items
    .filter((item) => item.assessmentId === result.assessmentId)
    .sort((left, right) => left.itemNumber - right.itemNumber);
  const versionKey = (state.answerKeys[result.assessmentId] ?? {})[result.version] ?? {};
  const omrItems = omrItemsOf(assessmentItems);
  const now = Date.now();
  return {
    ...state,
    results: state.results.map((current) =>
      current.id === result.id
        ? (() => {
            const scanId = current.sourceScanId ?? current.id;
            const resolution = resolveScanItemDecisions({
              scanItems: current.scanItems ?? [],
              omrItems,
              decisions,
              eventIds,
              actorId,
              scanId,
              source: "review_queue",
            });
            const effectiveResponses = { ...responses };
            resolution.decisionValuesByItemId.forEach((value, itemId) => {
              effectiveResponses[itemId] = value;
            });
            resolution.unresolvedByItemId.forEach((_status, itemId) => {
              effectiveResponses[itemId] = "";
            });
            const summary = computeScores(assessmentItems, versionKey, {
              ...emptyInput(),
              responses: effectiveResponses,
            });
            const scored = scoreExcludingUnresolved(
              summary.itemScores,
              resolution.unresolvedByItemId,
            );
            const answers = assessmentItems.map((item) => ({
              itemId: item.id,
              response: effectiveResponses[item.id] ?? "",
            }));
            const manualItemsRemain = omrItems.length !== assessmentItems.length;
            const mustReview = manualItemsRemain || resolution.unresolvedByItemId.size > 0;
            return {
              ...current,
              answers,
              itemScores: scored.itemScores,
              rawScore: scored.raw,
              totalScore: scored.total,
              percentage: scored.pct,
              masteryStatus: scored.masteryStatus,
              reviewed: !mustReview,
              reviewStatus: mustReview ? "needs_review" as const : "reviewed" as const,
              finalizedAt: mustReview ? null : current.finalizedAt,
              scanItems: resolution.scanItems,
              sourceScanId: scanId,
              auditLog: current.auditLog.concat(resolution.audits, {
                at: now,
                action: mustReview
                  ? manualItemsRemain
                    ? "OMR review completed; manual-scoring items still pending"
                    : "Review remains pending; explicit OMR decisions are still required"
                  : "Reviewed and confirmed",
                actorId,
                source: "review_queue" as const,
                scanId,
              }),
              updatedAt: now,
            };
          })()
        : current,
    ),
  };
}
