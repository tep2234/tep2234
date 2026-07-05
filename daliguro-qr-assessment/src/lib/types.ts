// ============================================================
// DALIguro QR Assessment — Data Model (Phase 2)
// Standalone, offline-first. No DALIguro / Supabase coupling yet.
// ============================================================

// ---- Controlled vocabularies -------------------------------

export const ASSESSMENT_COMPONENTS = [
  "Written Work",
  "Performance Task",
  "Quarterly Assessment",
] as const;
export type AssessmentComponent = (typeof ASSESSMENT_COMPONENTS)[number];

export const TEST_VERSIONS = ["A", "B", "C", "D"] as const;
export type TestVersion = (typeof TEST_VERSIONS)[number];

export const TERMS = ["First", "Second", "Third"] as const;
export type Term = (typeof TERMS)[number];

export const ITEM_TYPES = [
  "Multiple Choice",
  "True or False",
  "Matching Type",
  "Sequencing",
  "Identification",
  "Fill in the Blank",
  "Short Answer",
  "Problem Solving",
  "Essay",
  "Performance Task",
  "Oral Assessment",
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

// Item types that can be auto-scored against a single correct answer.
export const OBJECTIVE_ITEM_TYPES: ItemType[] = [
  "Multiple Choice",
  "True or False",
  "Matching Type",
  "Sequencing",
];

export const DIFFICULTIES = ["Easy", "Average", "Difficult"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

// Bloom's levels used to tag items for cognitive-level analysis.
export const COGNITIVE_LEVELS = [
  "Remembering",
  "Understanding",
  "Applying",
  "Analyzing",
  "Evaluating",
  "Creating",
] as const;
export type CognitiveLevel = (typeof COGNITIVE_LEVELS)[number];

export const SEX_VALUES = ["M", "F"] as const;
export type Sex = (typeof SEX_VALUES)[number];

// SmartScan mastery bands: ≥80 / 60–79 / 40–59 / <40.
export const MASTERY_STATUSES = [
  "Mastered",
  "Near Mastery",
  "Needs Reinforcement",
  "Critical Support",
] as const;
export type MasteryStatus = (typeof MASTERY_STATUSES)[number];

// Lifecycle of a result: auto-accepted scan → needs review → teacher reviewed
// → finalized (locked; edits require a reason and are audit-logged).
export const REVIEW_STATUSES = [
  "auto",
  "needs_review",
  "reviewed",
  "finalized",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

// ---- Core entities -----------------------------------------

export interface Assessment {
  id: string;
  title: string;
  subject: string;
  gradeLevel: string;
  section: string;
  schoolYear: string;
  term: Term;
  component: AssessmentComponent;
  versions: TestVersion[];
  teacherName: string;
  createdAt: number;
  updatedAt: number;
}

export interface Item {
  id: string;
  assessmentId: string;
  itemNumber: number;
  type: ItemType;
  question: string;
  // Correct answer for objective items (e.g. "A", "T"). Empty for subjective.
  correctAnswer: string;
  // Extra acceptable answers for identification / fill-in / short answer.
  acceptedAnswers: string[];
  points: number;
  competency: string;
  // Topic/lesson label for grouping in analysis ("" = untagged).
  topic: string;
  difficulty: Difficulty;
  // Bloom's cognitive level ("" = untagged).
  cognitiveLevel: CognitiveLevel | "";
  // Number of choices for Multiple Choice / Matching (drives the option set).
  choices: number;
}

export interface Learner {
  id: string;
  lrn: string;
  fullName: string;
  sex: Sex;
  gradeLevel: string;
  section: string;
}

// A learner's answer to a single item.
export interface Answer {
  itemId: string;
  // Raw response: a letter (objective), free text, or "" when blank.
  response: string;
}

// Per-item scoring outcome computed during checking.
export interface ItemScore {
  itemId: string;
  itemNumber: number;
  type: ItemType;
  points: number;
  awarded: number;
  correct: boolean;
  blank: boolean;
  // True for subjective items scored manually by the teacher.
  manual: boolean;
  // True when the teacher overrode the auto-computed score.
  overridden: boolean;
  remarks: string;
}

// How a bubble read was classified by the OMR detector.
export type ScanItemStatus = "selected" | "blank" | "unclear" | "multiple";

// Raw per-item detection snapshot kept on scanned results so the Review tab
// can re-examine doubtful marks without the original image.
export interface ScanItemMeta {
  itemNumber: number;
  detected: string | null; // raw detected letter, before teacher corrections
  status: ScanItemStatus;
  confidence: number; // 0..1
}

// One entry per state change / manual edit, for score audit trails.
export interface AuditEntry {
  at: number;
  action: string;
  reason?: string;
}

export interface Result {
  id: string;
  assessmentId: string;
  learnerId: string;
  version: TestVersion;
  answers: Answer[];
  itemScores: ItemScore[];
  rawScore: number;
  totalScore: number;
  percentage: number;
  masteryStatus: MasteryStatus;
  reviewed: boolean;
  // How this result was produced.
  source: "scan" | "manual";
  // Overall scan trust score (0..1); null for manual checking.
  scanConfidence: number | null;
  reviewStatus: ReviewStatus;
  finalizedAt: number | null;
  // Raw detection snapshot (scanned results only).
  scanItems: ScanItemMeta[] | null;
  auditLog: AuditEntry[];
  // createdAt doubles as checkedAt; updatedAt changes on every re-save.
  createdAt: number;
  updatedAt: number;
}

// ---- Answer keys -------------------------------------------
// Keys are stored separately and NEVER embedded in QR codes.
// Shape: answerKeys[assessmentId][version][itemId] = correctAnswer

export type VersionKey = Record<string, string>;
export type AssessmentKeys = Partial<Record<TestVersion, VersionKey>>;
export type AnswerKeyMap = Record<string, AssessmentKeys>;

// ---- QR payload --------------------------------------------
// Identity only. No answer key, no correct answers, no score.

export interface QrPayload {
  assessmentId: string;
  learnerId: string;
  lrn: string;
  section: string;
  gradeLevel: string;
  version: TestVersion;
  securityToken: string;
  // Number of OMR items the sheet was printed with (mismatch = stale sheet).
  n: number;
  // Integrity checksum over assessmentId|learnerId|version ("" on old QRs).
  checksum: string;
}

// ---- Persisted application state ---------------------------

export interface QrAssessmentState {
  assessments: Assessment[];
  items: Item[];
  learners: Learner[];
  answerKeys: AnswerKeyMap;
  results: Result[];
}

export function emptyState(): QrAssessmentState {
  return {
    assessments: [],
    items: [],
    learners: [],
    answerKeys: {},
    results: [],
  };
}
