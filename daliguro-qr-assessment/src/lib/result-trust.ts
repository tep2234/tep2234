import type { Result } from "./types";
import type { ScanItemMeta } from "./types";
import { BLANK_REVIEW_CONFIDENCE, REVIEW_CONFIDENCE } from "./scanner/omr-score";

export function scanItemRequiresDecision(item: ScanItemMeta): boolean {
  return (
    item.status === "unreadable" ||
    item.status === "unclear" ||
    item.status === "multiple" ||
    (item.status === "selected" && item.confidence < REVIEW_CONFIDENCE) ||
    (item.status === "blank" && item.confidence < BLANK_REVIEW_CONFIDENCE)
  );
}

function expectedScanRows(result: Result): number {
  return result.itemScores.filter((score) =>
    score.type === "Multiple Choice" ||
    score.type === "Matching Type" ||
    score.type === "Sequencing",
  ).length;
}

export function unresolvedScanItemCount(result: Result): number {
  const expectedRows = expectedScanRows(result);
  const represented = result.scanItems?.length ?? 0;
  const metadataCount = (result.scanItems ?? []).filter(scanItemRequiresDecision).length;
  const missingCount = result.scanItems === null ? 0 : Math.max(0, expectedRows - represented);
  const malformedCoverage = result.scanItems !== null && (
    represented !== expectedRows ||
    result.scanItems.some((item, index) => item.itemNumber !== index + 1)
  );
  const coverageCount = malformedCoverage ? Math.max(1, missingCount) : missingCount;
  const scoreCount = result.itemScores.filter((score) => score.unresolved === true).length;
  return Math.max(metadataCount + coverageCount, scoreCount);
}

export function hasUnresolvedScanEvidence(result: Result): boolean {
  const expectedRows = expectedScanRows(result);
  const incompleteCoverage = result.scanItems !== null && (
    result.scanItems.length !== expectedRows ||
    result.scanItems.some((item, index) => item.itemNumber !== index + 1)
  );
  return (
    incompleteCoverage ||
    unresolvedScanItemCount(result) > 0
  );
}

export function isTrustedResult(result: Result): boolean {
  return result.reviewStatus !== "needs_review" && !hasUnresolvedScanEvidence(result);
}

export function trustedResults(results: Result[]): Result[] {
  return results.filter(isTrustedResult);
}

export function pendingReviewResults(results: Result[]): Result[] {
  return results.filter(
    (result) => result.reviewStatus === "needs_review" || hasUnresolvedScanEvidence(result),
  );
}

export function manualFallbackBlocked(result: Result | undefined): boolean {
  return Boolean(result && hasUnresolvedScanEvidence(result));
}
