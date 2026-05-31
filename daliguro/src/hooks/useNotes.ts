'use client';
import { useState, useEffect } from 'react';
import { StudentNote, ClassNote } from '@/types';
import { getAll, save, generateId, STORAGE_KEYS } from '@/lib/storage';

export function useStudentNotes(studentId?: string) {
  const [allNotes, setAllNotes] = useState<StudentNote[]>([]);

  useEffect(() => {
    setAllNotes(getAll<StudentNote>(STORAGE_KEYS.STUDENT_NOTES));
  }, []);

  const persist = (updated: StudentNote[]) => {
    setAllNotes(updated);
    save(STORAGE_KEYS.STUDENT_NOTES, updated);
  };

  const notes = studentId ? allNotes.filter(n => n.studentId === studentId) : allNotes;

  const addNote = (data: Omit<StudentNote, 'id' | 'createdAt'>) => {
    const note: StudentNote = { ...data, id: generateId(), createdAt: new Date().toISOString() };
    persist([...allNotes, note]);
    return note;
  };

  const deleteNote = (id: string) => {
    persist(allNotes.filter(n => n.id !== id));
  };

  return { notes, allNotes, addNote, deleteNote };
}

export function useClassNotes(classId?: string) {
  const [allNotes, setAllNotes] = useState<ClassNote[]>([]);

  useEffect(() => {
    setAllNotes(getAll<ClassNote>(STORAGE_KEYS.CLASS_NOTES));
  }, []);

  const persist = (updated: ClassNote[]) => {
    setAllNotes(updated);
    save(STORAGE_KEYS.CLASS_NOTES, updated);
  };

  const notes = classId ? allNotes.filter(n => n.classId === classId) : allNotes;

  const addNote = (classId: string, note: string) => {
    const newNote: ClassNote = { id: generateId(), classId, note, createdAt: new Date().toISOString() };
    persist([...allNotes, newNote]);
    return newNote;
  };

  const deleteNote = (id: string) => {
    persist(allNotes.filter(n => n.id !== id));
  };

  return { notes, allNotes, addNote, deleteNote };
}
