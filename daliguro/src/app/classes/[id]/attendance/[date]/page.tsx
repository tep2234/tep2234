'use client';
import { use, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useClasses } from '@/hooks/useClasses';
import { useStudents } from '@/hooks/useStudents';
import { useAttendance } from '@/hooks/useAttendance';
import Toast from '@/components/ui/Toast';

interface Props { params: Promise<{ id: string; date: string }> }

interface AttendanceRow {
  studentId: string;
  present: boolean;
  late: boolean;
  absenceType: string;
  excused: boolean;
}

export default function DailyAttendancePage({ params }: Props) {
  const { id, date } = use(params);
  const router = useRouter();
  const { getClass } = useClasses();
  const { students } = useStudents(id);
  const { records, saveAttendanceForDate } = useAttendance(id);
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const cls = getClass(id);

  useEffect(() => {
    const existing = records.filter(r => r.date === date);
    setRows(students.map(s => {
      const rec = existing.find(r => r.studentId === s.id);
      return {
        studentId: s.id,
        present: rec ? rec.present : true,
        late: rec ? rec.late : false,
        absenceType: rec?.absenceType || '',
        excused: rec?.excused || false,
      };
    }));
  }, [students.length, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (studentId: string, changes: Partial<AttendanceRow>) => {
    setRows(r => r.map(row => row.studentId === studentId ? { ...row, ...changes } : row));
  };

  const handleSave = () => {
    saveAttendanceForDate(id, date, rows.map(r => ({
      classId: id, studentId: r.studentId, date,
      present: r.present, late: r.late,
      absenceType: r.absenceType || undefined,
      excused: r.excused || undefined,
    })));
    setToast('Attendance saved!');
    setTimeout(() => router.push(`/classes/${id}/attendance`), 1000);
  };

  const formatDisplayDate = (d: string) => {
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    } catch { return d; }
  };

  const getStatus = (row: AttendanceRow) => {
    if (row.excused) return { label: 'Excused', cls: 'bg-blue-100 text-blue-700' };
    if (row.late) return { label: 'L', cls: 'bg-amber-100 text-amber-700' };
    if (row.present) return { label: 'P', cls: 'bg-green-100 text-green-700' };
    return { label: 'A', cls: 'bg-red-100 text-red-700' };
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-r from-[#0F1629] to-[#1B2035] text-white px-6 py-6">
        <div className="max-w-5xl mx-auto">
          <Link href={`/classes/${id}/attendance`} className="text-white/50 text-sm hover:text-white/80 mb-2 inline-block">← Back to Attendance</Link>
          <div className="flex items-start justify-between">
            <div>
              <span className="bg-white/10 text-white/70 text-xs font-bold px-2 py-0.5 rounded-full">{cls?.name}</span>
              <h1 className="text-2xl font-bold mt-1">{formatDisplayDate(date)}</h1>
              <p className="text-white/50 text-sm">{students.length} Total Students</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Student Name / LRN</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Present</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Late</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Absence Type</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Excused</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => {
                const row = rows[i] || { studentId: s.id, present: true, late: false, absenceType: '', excused: false };
                const status = getStatus(row);
                return (
                  <tr key={s.id} className="border-b border-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-gray-800">{s.lastName}, {s.firstName}</p>
                      <p className="text-xs text-gray-400">{s.lrn || 'No LRN'}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => update(s.id, { present: !row.present, late: false })}
                        className={`w-8 h-8 rounded-full font-bold text-sm transition-colors ${row.present && !row.late ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-400'}`}
                      >✓</button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => update(s.id, { late: !row.late, present: !row.late })}
                        className={`w-8 h-8 rounded-full font-bold text-sm transition-colors ${row.late ? 'bg-amber-400 text-white' : 'bg-gray-100 text-gray-400'}`}
                      >⏰</button>
                    </td>
                    <td className="px-4 py-3">
                      {!row.present && !row.late && (
                        <select value={row.absenceType} onChange={e => update(s.id, { absenceType: e.target.value })}
                          className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:outline-none">
                          <option value="">Select type...</option>
                          <option>Sick</option>
                          <option>Family Matter</option>
                          <option>Other</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => update(s.id, { excused: !row.excused })}
                        className={`w-8 h-8 rounded-full font-bold text-sm transition-colors ${row.excused ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400'}`}
                      >📄</button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${status.cls}`}>{status.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end mt-6">
          <button onClick={handleSave} className="bg-gray-900 hover:bg-gray-800 text-white font-semibold px-8 py-3 rounded-xl">
            Save Attendance
          </button>
        </div>
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
