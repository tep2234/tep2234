// ── DepEd Grading Policy Types ───────────────────────────────────────────────
export type KeyStage = 'KS1' | 'KS2' | 'KS3' | 'KS4';

export type GradeCategory = 'WW' | 'PT' | 'QA' | 'STTE';
// WW = Written/Oral Works, PT = Performance Tasks,
// QA = Quarterly Assessment (legacy 4-quarter), STTE = Summative Tests + Term Exam (3-term)

export interface GradingResult {
  wwPS: number;    // WW percentage score
  ptPS: number;    // PT percentage score
  stTePS: number;  // STs-TE percentage score (0 when no term exam)
  wwWS: number;    // WW weighted score
  ptWS: number;    // PT weighted score
  stTeWS: number;  // STs-TE weighted score
  initialGrade: number;
  transmutedGrade: number;
  descriptor: string;
  intervention: string;
}

export interface KS1Rating {
  id: string;
  studentId: string;
  subjectId: string;
  term: number;
  competency: string;
  descriptor: string;
  teacherRemarks?: string;
  createdAt: string;
}

// ── Core domain types ────────────────────────────────────────────────────────

export interface Class {
  id: string;
  gradLevel: string;
  program: string;
  name: string;
  schoolYear: string;
  gradingPeriods: number;
  createdAt: string;
  starred?: boolean;
}

export interface Student {
  id: string;
  classId: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  lrn?: string;
  birthday: string;
  gender: 'Male' | 'Female';
  guardian?: string;
  contact?: string;
  email?: string;
}

export interface AttendanceRecord {
  id: string;
  classId: string;
  studentId: string;
  date: string;
  present: boolean;
  late: boolean;
  absenceType?: string;
  excused?: boolean;
}

export interface Subject {
  id: string;
  classId: string;
  name: string;
  code: string;
  // Legacy 4-quarter weights (kept for backward compat)
  wwWeight: number;
  ptWeight: number;
  qaWeight: number;
  // DepEd three-term policy fields (SY 2026-2027)
  keyStage?: KeyStage;
  subjectGroup?: string;
  useThreeTerms?: boolean; // true = 3-term system (Terms 1–3)
  // Per-subject weight overrides (null stTe = no term exam)
  wwWeightPolicy?: number;
  ptWeightPolicy?: number;
  stTeWeightPolicy?: number | null;
}

export interface GradeEntry {
  id: string;
  subjectId: string;
  studentId: string;
  quarter: number; // 1–4 (legacy) or 1–3 (three-term, Term 1–3)
  category: GradeCategory;
  columnIndex: number;
  score: number | null;
}

export interface StudentNote {
  id: string;
  studentId: string;
  classId: string;
  category: string;
  observation: string;
  createdAt: string;
}

export interface ClassNote {
  id: string;
  classId: string;
  note: string;
  createdAt: string;
}

export interface RecitationSession {
  id: string;
  classId: string;
  subjectId: string;
  topic: string;
  status: 'draft' | 'active' | 'completed';
  questions: RecitationQuestion[];
  scores: RecitationScore[];
  createdAt: string;
}

export interface RecitationQuestion {
  id: string;
  question: string;
  expectedAnswer: string;
}

export interface RecitationScore {
  studentId: string;
  points: number;
}

export interface Assessment {
  id: string;
  classId: string;
  subjectId: string;
  quarter: number;
  type: 'Quarterly Exam' | 'Long Test' | 'Quiz';
  items: number;
  createdAt: string;
  tosRows: TosRow[];
  questions: AssessmentQuestion[];
}

export interface TosRow {
  topic: string;
  hoursTaught: number;
  weightPercent: number;
  numItems: number;
  rem: number;
  und: number;
  app: number;
  ana: number;
  eva: number;
  cre: number;
  itemPlacement: string;
}

export interface AssessmentQuestion {
  number: number;
  question: string;
  choices: string[];
  answer: string;
}
