// DepEd SY 2026-2027 configurable grading policy
// Three-term school calendar (DO 009, s. 2026)
// DO NOT hardcode as "DO 009 grading table" — store as configurable policy

export type KeyStage = 'KS1' | 'KS2' | 'KS3' | 'KS4';

export interface ComponentWeights {
  ww: number;
  pt: number;
  stTe: number | null; // null = no term exam (Research & Design, Work Immersion)
}

// Grade level → Key Stage
export const GRADE_TO_KS: Record<string, KeyStage> = {
  Kindergarten: 'KS1',
  'Grade 1': 'KS1',
  'Grade 2': 'KS1',
  'Grade 3': 'KS1',
  'Grade 4': 'KS2',
  'Grade 5': 'KS2',
  'Grade 6': 'KS2',
  'Grade 7': 'KS3',
  'Grade 8': 'KS3',
  'Grade 9': 'KS3',
  'Grade 10': 'KS3',
  'Grade 11': 'KS4',
  'Grade 12': 'KS4',
  College: 'KS4',
};

// Subject groups per key stage
export const SUBJECT_GROUPS_BY_KS: Record<KeyStage, string[]> = {
  KS1: ['Descriptive'],
  KS2: ['Core', 'Skill-Based'],
  KS3: ['Core', 'Skill-Based'],
  KS4: [
    'Core / Academic Elective',
    'Field Exposure / Apprenticeship',
    'Arts / Sports / Health Elective',
    'Research & Design Elective',
    'TechPro Elective',
    'Work Immersion',
  ],
};

// Core subjects by key stage (reference only — teacher selects group)
export const CORE_SUBJECTS: Record<string, string[]> = {
  KS2: ['English', 'Mathematics', 'Science', 'Araling Panlipunan', 'Filipino', 'GMRC', 'MTB-MLE'],
  KS3: ['English', 'Mathematics', 'Science', 'Araling Panlipunan', 'Filipino', 'EsP', 'GMRC'],
};

export const SKILL_BASED_SUBJECTS: Record<string, string[]> = {
  KS2: ['EPP', 'MAPEH'],
  KS3: ['TLE', 'MAPEH'],
};

// Weight table keyed by "KS_SubjectGroup"
export const COMPONENT_WEIGHTS: Record<string, ComponentWeights> = {
  KS1_Descriptive: { ww: 0, pt: 0, stTe: 0 },
  KS2_Core: { ww: 20, pt: 50, stTe: 30 },
  'KS2_Skill-Based': { ww: 20, pt: 60, stTe: 20 },
  KS3_Core: { ww: 20, pt: 50, stTe: 30 },
  'KS3_Skill-Based': { ww: 20, pt: 60, stTe: 20 },
  'KS4_Core / Academic Elective': { ww: 20, pt: 50, stTe: 30 },
  'KS4_Field Exposure / Apprenticeship': { ww: 15, pt: 70, stTe: 15 },
  'KS4_Arts / Sports / Health Elective': { ww: 20, pt: 60, stTe: 20 },
  'KS4_Research & Design Elective': { ww: 40, pt: 60, stTe: null },
  'KS4_TechPro Elective': { ww: 15, pt: 65, stTe: 20 },
  'KS4_Work Immersion': { ww: 20, pt: 80, stTe: null },
};

export function getWeights(keyStage: KeyStage, subjectGroup: string): ComponentWeights {
  const key = `${keyStage}_${subjectGroup}`;
  return COMPONENT_WEIGHTS[key] ?? { ww: 20, pt: 50, stTe: 30 };
}

export function getKeyStage(gradLevel: string): KeyStage {
  return GRADE_TO_KS[gradLevel] ?? 'KS3';
}

export function getDefaultSubjectGroup(keyStage: KeyStage): string {
  return SUBJECT_GROUPS_BY_KS[keyStage][0] ?? 'Core';
}

export function hasTermExam(keyStage: KeyStage, subjectGroup: string): boolean {
  const w = getWeights(keyStage, subjectGroup);
  return w.stTe !== null && w.stTe > 0;
}

export function isKS1(gradLevel: string): boolean {
  return ['Kindergarten', 'Grade 1', 'Grade 2', 'Grade 3'].includes(gradLevel);
}

// ── Descriptors (KS2–KS4 numerical grades) ──────────────────────────────────

export function getDescriptor(grade: number): string {
  if (grade >= 90) return 'Advancing';
  if (grade >= 80) return 'Benchmarking';
  if (grade >= 75) return 'Connecting';
  if (grade >= 65) return 'Developing';
  return 'Emerging';
}

export function getIntervention(grade: number): string {
  if (grade >= 90) return 'Enrichment';
  if (grade >= 80) return 'Deeper application';
  if (grade >= 75) return 'Guided practice';
  if (grade >= 65) return 'Targeted remediation';
  return 'Intensive support';
}

export function getDescriptorColor(grade: number): string {
  if (grade >= 90) return 'bg-green-100 text-green-700 border-green-200';
  if (grade >= 80) return 'bg-blue-100 text-blue-700 border-blue-200';
  if (grade >= 75) return 'bg-sky-100 text-sky-700 border-sky-200';
  if (grade >= 65) return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
}

// ── SY 2026-2027 three-term transmutation table ──────────────────────────────
// Published examples: 85.00–85.99 → 87, 70.00–72.99 → 75
// Update this array when DepEd releases the final official table

export const SY2026_TRANSMUTATION: Array<{ min: number; out: number }> = [
  { min: 98.00, out: 100 },
  { min: 97.00, out: 99 },
  { min: 96.00, out: 98 },
  { min: 95.00, out: 97 },
  { min: 94.00, out: 96 },
  { min: 93.00, out: 95 },
  { min: 92.00, out: 94 },
  { min: 91.00, out: 93 },
  { min: 90.00, out: 92 },
  { min: 89.00, out: 91 },
  { min: 88.00, out: 90 },
  { min: 87.00, out: 89 },
  { min: 86.00, out: 88 },
  { min: 85.00, out: 87 }, // published: 85.00–85.99 → 87
  { min: 84.00, out: 86 },
  { min: 83.00, out: 85 },
  { min: 82.00, out: 84 },
  { min: 81.00, out: 83 },
  { min: 80.00, out: 82 },
  { min: 79.00, out: 81 },
  { min: 78.00, out: 80 },
  { min: 77.00, out: 79 },
  { min: 76.00, out: 78 },
  { min: 75.00, out: 77 },
  { min: 73.00, out: 76 },
  { min: 70.00, out: 75 }, // published: 70.00–72.99 → 75
  { min: 65.00, out: 74 },
  { min: 60.00, out: 73 },
  { min: 55.00, out: 72 },
  { min: 50.00, out: 71 },
  { min: 45.00, out: 70 },
  { min: 40.00, out: 69 },
  { min: 35.00, out: 68 },
  { min: 30.00, out: 67 },
  { min: 25.00, out: 66 },
  { min: 20.00, out: 65 },
  { min: 15.00, out: 64 },
  { min: 10.00, out: 63 },
  { min: 5.00, out: 62 },
  { min: 0.00, out: 60 },
];

export function transmuteSY2026(initialGrade: number): number {
  if (initialGrade >= 100) return 100;
  for (const row of SY2026_TRANSMUTATION) {
    if (initialGrade >= row.min) return row.out;
  }
  return 60;
}

// Final grade = average of all term grades (3 terms)
export function computeFinalGrade(termGrades: (number | null)[]): number {
  const valid = termGrades.filter((g): g is number => g !== null && g > 0);
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((s, g) => s + g, 0) / valid.length);
}

// WW/PT column limits per component
export const COLUMN_LIMITS: Record<string, { min: number; max: number }> = {
  WW: { min: 3, max: 5 },   // 3–5 WW per term
  PT: { min: 2, max: 3 },   // 2–3 PT per term
  STTE: { min: 3, max: 3 }, // 2 summative tests + 1 term exam = 3
};
