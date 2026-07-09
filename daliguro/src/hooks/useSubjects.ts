'use client';
import { useState, useEffect } from 'react';
import { Subject } from '@/types';
import { getAll, save, generateId, STORAGE_KEYS } from '@/lib/storage';

export function useSubjects(classId?: string) {
  const [allSubjects, setAllSubjects] = useState<Subject[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setAllSubjects(getAll<Subject>(STORAGE_KEYS.SUBJECTS));
    setLoaded(true);
  }, []);

  const persist = (updated: Subject[]) => {
    setAllSubjects(updated);
    save(STORAGE_KEYS.SUBJECTS, updated);
  };

  const subjects = classId ? allSubjects.filter(s => s.classId === classId) : allSubjects;

  const addSubject = (data: Omit<Subject, 'id'>) => {
    const subject: Subject = { ...data, id: generateId() };
    persist([...allSubjects, subject]);
    return subject;
  };

  const updateSubject = (id: string, data: Partial<Subject>) => {
    persist(allSubjects.map(s => s.id === id ? { ...s, ...data } : s));
  };

  const deleteSubject = (id: string) => {
    persist(allSubjects.filter(s => s.id !== id));
  };

  const getSubject = (id: string) => allSubjects.find(s => s.id === id);

  return { subjects, allSubjects, loaded, addSubject, updateSubject, deleteSubject, getSubject };
}
