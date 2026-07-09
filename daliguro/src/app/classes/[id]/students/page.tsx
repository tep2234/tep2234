'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useClasses } from '@/hooks/useClasses';
import { useStudents } from '@/hooks/useStudents';
import Avatar from '@/components/ui/Avatar';
import AddStudentModal from '@/components/students/AddStudentModal';
import BulkImportModal from '@/components/students/BulkImportModal';
import Toast from '@/components/ui/Toast';
import { Student } from '@/types';

interface Props { params: Promise<{ id: string }> }

export default function StudentsPage({ params }: Props) {
  const { id } = use(params);
  const { getClass } = useClasses();
  const { students, addStudent, deleteStudent, bulkAddStudents } = useStudents(id);
  const [showAdd, setShowAdd] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const cls = getClass(id);

  const handleAdd = (data: Omit<Student, 'id'>) => {
    addStudent(data);
    setToast('Student added!');
  };

  const handleBulkImport = (students: Omit<Student, 'id'>[], count: number) => {
    bulkAddStudents(students);
    setToast(`Perfect Upload! All ${count} students were successfully added.`);
  };

  const handleDelete = (student: Student) => {
    if (confirm(`Delete ${student.firstName} ${student.lastName}?`)) {
      deleteStudent(student.id);
      setToast('Student removed.');
    }
  };

  const formatBirthday = (b: string) => {
    if (!b) return '—';
    try { return new Date(b + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch { return b; }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#0F1629] to-[#1B2035] text-white px-6 py-6">
        <div className="max-w-5xl mx-auto">
          <Link href={`/classes/${id}`} className="text-white/50 text-sm hover:text-white/80 mb-2 inline-block">← Back to Class Overview</Link>
          <div className="flex items-start justify-between">
            <div>
              <span className="bg-white/10 text-white/70 text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">Class Roster</span>
              <h1 className="text-2xl font-bold mt-1">{cls?.name || '...'}</h1>
              <p className="text-white/50 text-sm">Manage your {students.length} enrolled students for this section</p>
            </div>
            {students.length > 0 && (
              <div className="flex gap-2">
                <button onClick={() => setShowBulk(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">Bulk Import</button>
                <button onClick={() => setShowAdd(true)} className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">+ Add Student</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {students.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-6xl mb-4">🎓</div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">No students enrolled yet</h3>
            <p className="text-gray-500 mb-6">Add your first student or import your entire class roster at once.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowAdd(true)} className="bg-gray-900 hover:bg-gray-800 text-white font-semibold px-6 py-2.5 rounded-xl text-sm">+ Add Single Student</button>
              <button onClick={() => setShowBulk(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-6 py-2.5 rounded-xl text-sm">Bulk Import Roster</button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Student</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">LRN</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Birthday</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Gender</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {students.map(s => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50 group">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar firstName={s.firstName} lastName={s.lastName} size="sm" />
                        <span className="font-semibold text-gray-800">{s.lastName}, {s.firstName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{s.lrn || <span className="text-gray-300">None</span>}</td>
                    <td className="px-4 py-3 text-gray-600">{formatBirthday(s.birthday)}</td>
                    <td className="px-4 py-3">
                      <span className={`font-semibold ${s.gender === 'Male' ? 'text-blue-600' : 'text-pink-500'}`}>{s.gender}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => handleDelete(s)} className="text-gray-300 hover:text-red-400 transition-colors" title="Delete">🗑</button>
                        <Link href={`/classes/${id}/students/${s.id}`} className="text-gray-300 hover:text-purple-500 transition-colors" title="View profile">→</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddStudentModal open={showAdd} classId={id} onClose={() => setShowAdd(false)} onSave={handleAdd} />
      <BulkImportModal open={showBulk} classId={id} onClose={() => setShowBulk(false)} onImport={handleBulkImport} />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
