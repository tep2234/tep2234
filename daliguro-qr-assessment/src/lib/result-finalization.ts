import type { Result } from "./types";
import { hasUnresolvedScanEvidence } from "./result-trust";

export function finalizeResults(results: Result[], ids: Set<string>, bulk: boolean): Result[] {
  const now = Date.now();
  return results.map((result) =>
    ids.has(result.id) &&
    (result.reviewStatus === "reviewed" || result.reviewStatus === "auto") &&
    !hasUnresolvedScanEvidence(result)
      ? {
          ...result,
          reviewStatus: "finalized" as const,
          finalizedAt: now,
          auditLog: result.auditLog.concat({
            at: now,
            action: bulk ? "Finalized (locked, bulk)" : "Finalized (locked)",
          }),
          updatedAt: now,
        }
      : result,
  );
}
