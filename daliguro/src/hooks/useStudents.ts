'use client';
import { useState, useEffect } from 'react';
import { Student } from '@/types';
import { getAll, save, generateId, STORAGE_KEYS } from '@/lib/storage';

export function useStudents(classId?: string) {
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setAllStudents(getAll<Student>(STORAGE_KEYS.STUDENTS));
    setLoaded(true);
  }, []);

  const persist = (updated: Student[]) => {
    setAllStudents(updated);
    save(STORAGE_KEYS.STUDENTS, updated);
  };

  const students = classId ? allStudents.filter(s => s.classId === classId) : allStudents;

  const addStudent = (data: Omit<Student, 'id'>) => {
    const student: Student = { ...data, id: generateId() };
    persist([...allStudents, student]);
    return student;
  };

  const updateStudent = (id: string, data: Partial<Student>) => {
    persist(allStudents.map(s => s.id === id ? { ...s, ...data } : s));
  };

  const deleteStudent = (id: string) => {
    persist(allStudents.filter(s => s.id !== id));
  };

  const getStudent = (id: string) => allStudents.find(s => s.id === id);

  const bulkAddStudents = (newStudents: Omit<Student, 'id'>[]) => {
    const withIds = newStudents.map(s => ({ ...s, id: generateId() }));
    persist([...allStudents, ...withIds]);
    return withIds;
  };

  return { students, allStudents, loaded, addStudent, updateStudent, deleteStudent, getStudent, bulkAddStudents };
}
