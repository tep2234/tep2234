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
  wwWeight: number;
  ptWeight: number;
  qaWeight: number;
}

export interface GradeEntry {
  id: string;
  subjectId: string;
  studentId: string;
  quarter: number;
  category: 'WW' | 'PT' | 'QA';
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
