import type { Result } from "./types";

export function isTrustedResult(result: Result): boolean {
  return result.reviewStatus !== "needs_review";
}

export function trustedResults(results: Result[]): Result[] {
  return results.filter(isTrustedResult);
}

export function pendingReviewResults(results: Result[]): Result[] {
  return results.filter((result) => result.reviewStatus === "needs_review");
}
