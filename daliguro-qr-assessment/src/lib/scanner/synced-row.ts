// Validate and translate a raw row received from the paired-phone scanner.
// Phone answer keys are OMR ROW numbers (1..N), not assessment item numbers:
// a subjective/manual item can appear anywhere in the assessment without
// occupying a bubble row. This boundary therefore maps through omrItemsOf and
// rejects incomplete or ambiguous runtime data before it reaches scoring.

import {
  SCAN_ITEM_STATUSES,
  type Assessment,
  type Item,
  type ScanItemMeta,
  type TestVersion,
} from "../types";
import type { CheckedResultRow } from "../sync/pairing";
import type { SyncedResultInput } from "./scan-save";
import { omrItemsOf } from "./omr-template";
import { BLANK_REVIEW_CONFIDENCE, REVIEW_CONFIDENCE } from "./omr-score";

const STATUSES = new Set<ScanItemMeta["status"]>(SCAN_ITEM_STATUSES);
const LETTERS = ["A", "B", "C", "D", "E"] as const;

export type SyncedRowRejectionCode =
  | "wrong_assessment"
  | "unknown_learner"
  | "invalid_qr_payload"
  | "missing_version"
  | "unsupported_version"
  | "identity_mismatch"
  | "no_omr_items"
  | "invalid_item_count"
  | "item_count_mismatch"
  | "invalid_answer_map"
  | "invalid_item_results";

export type SyncedRowMapping =
  | { ok: true; input: SyncedResultInput }
  | { ok: false; code: SyncedRowRejectionCode; message: string };

export interface SyncedRowContext {
  assessment: Assessment;
  items: Item[];
  // Omit only when the caller genuinely has no learner roster. CheckPanel has
  // one and always supplies it, so a forged/stale learner id is rejected.
  knownLearnerIds?: ReadonlySet<string>;
  forceReview?: boolean;
}

interface ParsedDetection {
  item: number;
  answer: string;
  status: ScanItemMeta["status"];
  confidence: number;
  fill?: number[];
  unreadableChoices?: number[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reject(code: SyncedRowRejectionCode, message: string): SyncedRowMapping {
  return { ok: false, code, message };
}

function identityField(payload: Record<string, unknown>, long: string, short: string): unknown {
  const longValue = payload[long];
  const shortValue = payload[short];
  if (longValue !== undefined && shortValue !== undefined && longValue !== shortValue) return null;
  return longValue ?? shortValue;
}

function parseDetection(value: unknown, expectedCount: number): ParsedDetection | null {
  if (!isRecord(value)) return null;
  const item = value.item;
  const answer = value.answer;
  const status = value.status;
  const confidence = value.confidence;
  if (!Number.isInteger(item) || (item as number) < 1 || (item as number) > expectedCount) return null;
  if (typeof answer !== "string") return null;
  if (typeof status !== "string" || !STATUSES.has(status as ScanItemMeta["status"])) return null;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  if (value.fill !== undefined) {
    if (!Array.isArray(value.fill) || value.fill.some((n) => typeof n !== "number" || !Number.isFinite(n))) return null;
  }
  if (
    value.unreadableChoices !== undefined &&
    (!Array.isArray(value.unreadableChoices) ||
      value.unreadableChoices.length > 5 ||
      value.unreadableChoices.some((choice) => typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice > 4) ||
      new Set(value.unreadableChoices).size !== value.unreadableChoices.length)
  ) return null;
  if (status === "unreadable" && (!Array.isArray(value.unreadableChoices) || value.unreadableChoices.length === 0)) return null;
  return {
    item: item as number,
    answer,
    status: status as ScanItemMeta["status"],
    confidence,
    fill: value.fill as number[] | undefined,
    unreadableChoices: value.unreadableChoices as number[] | undefined,
  };
}

function validAnswer(answer: unknown, choices: number): answer is string {
  if (typeof answer !== "string") return false;
  if (answer === "") return true;
  return LETTERS.slice(0, Math.max(0, Math.min(choices, LETTERS.length))).includes(
    answer as (typeof LETTERS)[number],
  );
}

export function mapSyncedRow(row: CheckedResultRow, context: SyncedRowContext): SyncedRowMapping {
  const { assessment } = context;
  if (row.assessment_id !== assessment.id) {
    return reject("wrong_assessment", "This scan belongs to a different assessment.");
  }
  if (typeof row.learner_id !== "string" || !row.learner_id.trim()) {
    return reject("unknown_learner", "The scan has no valid learner identity.");
  }
  if (context.knownLearnerIds && !context.knownLearnerIds.has(row.learner_id)) {
    return reject("unknown_learner", `Learner ${row.learner_id} is not in this roster.`);
  }

  if (!isRecord(row.qr_payload)) {
    return reject("invalid_qr_payload", "The scan is missing its QR identity payload.");
  }
  const rawVersion = identityField(row.qr_payload, "version", "v");
  if (rawVersion === undefined || rawVersion === "") {
    return reject("missing_version", "The sheet QR does not identify a test version.");
  }
  if (typeof rawVersion !== "string" || !assessment.versions.includes(rawVersion as TestVersion)) {
    return reject("unsupported_version", `Test version ${String(rawVersion)} is not enabled for this assessment.`);
  }
  const qrAssessmentId = identityField(row.qr_payload, "assessmentId", "a");
  const qrLearnerId = identityField(row.qr_payload, "learnerId", "l");
  if (
    qrAssessmentId === null ||
    qrLearnerId === null ||
    (qrAssessmentId !== undefined && qrAssessmentId !== assessment.id) ||
    (qrLearnerId !== undefined && qrLearnerId !== row.learner_id)
  ) {
    return reject("identity_mismatch", "The row identity does not match the sheet QR.");
  }

  const omrItems = omrItemsOf(context.items.filter((item) => item.assessmentId === assessment.id));
  const expectedCount = omrItems.length;
  if (expectedCount === 0) {
    return reject("no_omr_items", "This assessment has no scannable letter-choice items.");
  }
  if (typeof row.total_items !== "number" || !Number.isInteger(row.total_items) || row.total_items < 1) {
    return reject("invalid_item_count", "The scanner supplied an invalid item count.");
  }
  if (row.total_items !== expectedCount) {
    return reject(
      "item_count_mismatch",
      `The sheet contains ${row.total_items} OMR row(s), but this assessment requires ${expectedCount}.`,
    );
  }

  if (!isRecord(row.answer_map)) {
    return reject("invalid_answer_map", "The scan answer map is malformed.");
  }
  const answerKeys = Object.keys(row.answer_map);
  if (
    answerKeys.length !== expectedCount ||
    answerKeys.some((key, index) => key !== String(index + 1))
  ) {
    return reject("invalid_answer_map", "The scan does not contain exactly one answer for every OMR row.");
  }

  if (!Array.isArray(row.item_results) || row.item_results.length !== expectedCount) {
    return reject("invalid_item_results", "The scan does not contain a complete detection record.");
  }
  const detections = row.item_results.map((value) => parseDetection(value, expectedCount));
  if (detections.some((value) => value === null)) {
    return reject("invalid_item_results", "One or more OMR detections are malformed.");
  }
  const parsed = detections as ParsedDetection[];
  const seen = new Set(parsed.map((detection) => detection.item));
  if (seen.size !== expectedCount || Array.from({ length: expectedCount }, (_, index) => index + 1).some((n) => !seen.has(n))) {
    return reject("invalid_item_results", "The scan detection rows are missing or duplicated.");
  }
  parsed.sort((left, right) => left.item - right.item);

  const responses: Record<string, string> = {};
  for (let index = 0; index < expectedCount; index += 1) {
    const rowNumber = index + 1;
    const item = omrItems[index];
    const answer = row.answer_map[String(rowNumber)];
    const detection = parsed[index];
    if (!validAnswer(answer, item.choices) || detection.item !== rowNumber || detection.answer !== answer) {
      return reject("invalid_answer_map", `OMR row ${rowNumber} has inconsistent or invalid answer data.`);
    }
    // Critical mapping rule: OMR row index -> filtered OMR item -> stable item id.
    const resolved = detection.status === "selected" && detection.confidence >= REVIEW_CONFIDENCE;
    // Preserve the raw suggestion in scanItems, but never let an unresolved
    // visual state become a definite scored response.
    responses[item.id] = resolved ? answer : "";
  }

  const scanItems: ScanItemMeta[] = parsed.map((detection) => ({
    // Review rendering also consumes the compact OMR row index (1..N).
    itemNumber: detection.item,
    detected: detection.answer || null,
    status: detection.status,
    confidence: detection.confidence,
    fill: detection.fill,
    unreadableChoices: detection.unreadableChoices,
  }));
  const lowConfidenceList = Array.isArray(row.low_confidence_items) && row.low_confidence_items.length > 0;
  const hasDoubt =
    lowConfidenceList ||
    scanItems.some(
      (item) =>
        item.status === "unclear" ||
        item.status === "multiple" ||
        item.status === "unreadable" ||
        (item.status === "selected" && item.confidence < REVIEW_CONFIDENCE) ||
        (item.status === "blank" && item.confidence < BLANK_REVIEW_CONFIDENCE),
    );
  const confidence =
    typeof row.scan_confidence === "number" &&
    Number.isFinite(row.scan_confidence) &&
    row.scan_confidence >= 0 &&
    row.scan_confidence <= 1
      ? row.scan_confidence
      : null;
  const reviewStatus =
    context.forceReview || hasDoubt || confidence === null || confidence < 0.8
      ? "needs_review"
      : "auto";
  const input: SyncedResultInput = {
    assessmentId: assessment.id,
    learnerId: row.learner_id,
    version: rawVersion,
    responses,
    scanItems,
    confidence,
    reviewStatus,
  };
  // Newer sync contracts attach an idempotency key. Keep the mapper compatible
  // with older persisted rows while forwarding a valid key when one is present.
  const rawScanId = (row as CheckedResultRow & { scan_id?: unknown }).scan_id;
  if (typeof rawScanId === "string" && rawScanId.trim()) {
    (input as SyncedResultInput & { scanId?: string }).scanId = rawScanId;
  }
  return { ok: true, input };
}
