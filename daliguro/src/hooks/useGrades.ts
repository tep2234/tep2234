'use client';
import { useState, useEffect } from 'react';
import { GradeEntry } from '@/types';
import { getAll, save, generateId, STORAGE_KEYS } from '@/lib/storage';

export function useGrades(subjectId?: string) {
  const [allGrades, setAllGrades] = useState<GradeEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setAllGrades(getAll<GradeEntry>(STORAGE_KEYS.GRADES));
    setLoaded(true);
  }, []);

  const persist = (updated: GradeEntry[]) => {
    setAllGrades(updated);
    save(STORAGE_KEYS.GRADES, updated);
  };

  const grades = subjectId ? allGrades.filter(g => g.subjectId === subjectId) : allGrades;

  const upsertGrade = (entry: Omit<GradeEntry, 'id'>) => {
    const existing = allGrades.find(
      g => g.subjectId === entry.subjectId &&
           g.studentId === entry.studentId &&
           g.quarter === entry.quarter &&
           g.category === entry.category &&
           g.columnIndex === entry.columnIndex
    );
    if (existing) {
      persist(allGrades.map(g => g.id === existing.id ? { ...g, score: entry.score } : g));
    } else {
      persist([...allGrades, { ...entry, id: generateId() }]);
    }
  };

  const getGradesForStudent = (studentId: string, quarter: number, category: 'WW' | 'PT' | 'QA') =>
    grades.filter(g => g.studentId === studentId && g.quarter === quarter && g.category === category);

  const getScoreGrid = (studentId: string, quarter: number, category: 'WW' | 'PT' | 'QA', columns: number): (number | null)[] => {
    const entries = getGradesForStudent(studentId, quarter, category);
    const grid: (number | null)[] = Array(columns).fill(null);
    entries.forEach(e => {
      if (e.columnIndex < columns) grid[e.columnIndex] = e.score;
    });
    return grid;
  };

  return { grades, allGrades, loaded, upsertGrade, getGradesForStudent, getScoreGrid };
}
