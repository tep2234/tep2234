'use client';
import { useState, useEffect } from 'react';
import { AttendanceRecord } from '@/types';
import { getAll, save, generateId, STORAGE_KEYS } from '@/lib/storage';

export function useAttendance(classId?: string) {
  const [allRecords, setAllRecords] = useState<AttendanceRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setAllRecords(getAll<AttendanceRecord>(STORAGE_KEYS.ATTENDANCE));
    setLoaded(true);
  }, []);

  const persist = (updated: AttendanceRecord[]) => {
    setAllRecords(updated);
    save(STORAGE_KEYS.ATTENDANCE, updated);
  };

  const records = classId ? allRecords.filter(r => r.classId === classId) : allRecords;

  const saveAttendanceForDate = (classId: string, date: string, entries: Omit<AttendanceRecord, 'id'>[]) => {
    const withoutDate = allRecords.filter(r => !(r.classId === classId && r.date === date));
    const newRecords = entries.map(e => ({ ...e, id: generateId() }));
    persist([...withoutDate, ...newRecords]);
  };

  const getRecordsForDate = (date: string) =>
    records.filter(r => r.date === date);

  const getRecordsForStudent = (studentId: string) =>
    records.filter(r => r.studentId === studentId);

  const getAbsenceCount = (studentId: string) =>
    records.filter(r => r.studentId === studentId && !r.present && !r.late).length;

  const getLateCount = (studentId: string) =>
    records.filter(r => r.studentId === studentId && r.late).length;

  const hasRecordForDate = (date: string) =>
    records.some(r => r.date === date);

  return {
    records,
    allRecords,
    loaded,
    saveAttendanceForDate,
    getRecordsForDate,
    getRecordsForStudent,
    getAbsenceCount,
    getLateCount,
    hasRecordForDate,
  };
}
