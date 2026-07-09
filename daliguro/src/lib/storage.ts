export function getAll<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

export function save<T>(key: string, items: T[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    console.error('Failed to save to localStorage');
  }
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

export const STORAGE_KEYS = {
  CLASSES: 'daliguro_classes',
  STUDENTS: 'daliguro_students',
  ATTENDANCE: 'daliguro_attendance',
  SUBJECTS: 'daliguro_subjects',
  GRADES: 'daliguro_grades',
  STUDENT_NOTES: 'daliguro_student_notes',
  CLASS_NOTES: 'daliguro_class_notes',
  RECITATION_SESSIONS: 'daliguro_recitation_sessions',
  ASSESSMENTS: 'daliguro_assessments',
} as const;
