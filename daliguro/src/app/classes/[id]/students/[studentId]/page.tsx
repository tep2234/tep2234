'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useClasses } from '@/hooks/useClasses';
import { useStudents } from '@/hooks/useStudents';
import { useAttendance } from '@/hooks/useAttendance';
import { useSubjects } from '@/hooks/useSubjects';
import { useGrades } from '@/hooks/useGrades';
import { useStudentNotes } from '@/hooks/useNotes';
import Avatar from '@/components/ui/Avatar';
import Toast from '@/components/ui/Toast';
import { calcWS, calcFinalGrade } from '@/lib/gradeCalc';

interface Props { params: Promise<{ id: string; studentId: string }> }

export default function StudentProfilePage({ params }: Props) {
  const { id, studentId } = use(params);
  const { getClass } = useClasses();
  const { students, getStudent, deleteStudent } = useStudents(id);
  const { records } = useAttendance(id);
  const { subjects } = useSubjects(id);
  const { allGrades } = useGrades();
  const { notes, addNote, deleteNote } = useStudentNotes(studentId);
  const [activeQ, setActiveQ] = useState(1);
  const [noteForm, setNoteForm] = useState({ category: 'General Note', observation: '' });
  const [toast, setToast] = useState<string | null>(null);

  const cls = getClass(id);
  const student = getStudent(studentId);

  if (!student) return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-500">Student not found.</p></div>;

  const studentIndex = students.findIndex(s => s.id === studentId);
  const prevStudent = studentIndex > 0 ? students[studentIndex - 1] : null;
  const nextStudent = studentIndex < students.length - 1 ? students[studentIndex + 1] : null;

  const studentRecords = records.filter(r => r.studentId === studentId);
  const absences = studentRecords.filter(r => !r.present && !r.late).length;
  const lates = studentRecords.filter(r => r.late).length;
  const isAtRisk = absences >= 3;

  const getSubjectGrade = (subjectId: string, quarter: number) => {
    const grades = allGrades.filter(g => g.subjectId === subjectId && g.studentId === studentId && g.quarter === quarter);
    const subject = subjects.find(s => s.id === subjectId);
    if (!subject || grades.length === 0) return null;
    const getScores = (cat: 'WW' | 'PT' | 'QA') => grades.filter(g => g.category === cat).map(g => g.score);
    const allStudentGrades = allGrades.filter(g => g.subjectId === subjectId && g.quarter === quarter);
    const getHighest = (cat: 'WW' | 'PT' | 'QA') => {
      const cols = new Set(allStudentGrades.filter(g => g.category === cat).map(g => g.columnIndex));
      return Array.from(cols).map(ci => {
        const s = allStudentGrades.filter(g => g.category === cat && g.columnIndex === ci).map(g => g.score ?? 0);
        return s.length > 0 ? Math.max(...s) : 0;
      });
    };
    const wwWS = calcWS(getScores('WW'), getHighest('WW'), subject.wwWeight);
    const ptWS = calcWS(getScores('PT'), getHighest('PT'), subject.ptWeight);
    const qaWS = calcWS(getScores('QA'), getHighest('QA'), subject.qaWeight);
    return calcFinalGrade(wwWS, ptWS, qaWS);
  };

  const gradeColor = (g: number) => g >= 90 ? 'text-green-600' : g >= 85 ? 'text-blue-600' : g >= 80 ? 'text-amber-600' : g >= 75 ? 'text-orange-500' : 'text-red-600';

  const handleSaveNote = () => {
    if (!noteForm.observation.trim()) return;
    addNote({ studentId, classId: id, category: noteForm.category, observation: noteForm.observation.trim() });
    setNoteForm(f => ({ ...f, observation: '' }));
    setToast('Note saved!');
  };

  const formatDate = (d: string) => {
    if (!d) return '—';
    try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }); }
    catch { return d; }
  };

  const quarterGrades = subjects.map(sub => ({ sub, grade: getSubjectGrade(sub.id, activeQ) }));
  const validGrades = quarterGrades.filter(x => x.grade !== null).map(x => x.grade as number);
  const avgGrade = validGrades.length > 0 ? Math.round(validGrades.reduce((a, b) => a + b, 0) / validGrades.length) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-purple-700 to-indigo-800 text-white px-6 py-8">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <Link href={`/classes/${id}/students`} className="text-white/50 text-sm hover:text-white/80">← Back to Class</Link>
            <div className="flex items-center gap-3">
              {prevStudent && <Link href={`/classes/${id}/students/${prevStudent.id}`} className="text-white/60 hover:text-white text-sm">← Prev</Link>}
              {nextStudent && <Link href={`/classes/${id}/students/${nextStudent.id}`} className="text-white/60 hover:text-white text-sm">Next →</Link>}
            </div>
          </div>
          <div className="flex items-center gap-5">
            <Avatar firstName={student.firstName} lastName={student.lastName} size="lg" />
            <div>
              {student.lrn && <span className="bg-white/20 text-white/80 text-xs font-bold px-2 py-0.5 rounded-full mr-2">LRN: {student.lrn}</span>}
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${student.gender === 'Male' ? 'bg-blue-400/30 text-blue-100' : 'bg-pink-400/30 text-pink-100'}`}>{student.gender}</span>
              <h1 className="text-2xl font-black mt-1">{student.lastName}, {student.firstName} {student.middleName || ''}</h1>
              <p className="text-white/60 text-sm">{cls?.gradLevel} — {cls?.name}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-bold text-gray-800 mb-3">Personal Details</h3>
            <div className="space-y-2 text-sm">
              <div><span className="text-gray-400">Middle Name:</span> <span className="font-medium ml-2">{student.middleName || '—'}</span></div>
              <div><span className="text-gray-400">Birthday:</span> <span className="font-medium ml-2">{formatDate(student.birthday)}</span></div>
              <div><span className="text-gray-400">Guardian:</span> <span className="font-medium ml-2">{student.guardian || '—'}</span></div>
              <div><span className="text-gray-400">Contact:</span> <span className="font-medium ml-2">{student.contact || '—'}</span></div>
              <div><span className="text-gray-400">Email:</span> <span className="font-medium ml-2">{student.email || '—'}</span></div>
            </div>
          </div>

          <div className={`rounded-xl shadow-sm border p-5 ${isAtRisk ? 'bg-red-50 border-red-100' : 'bg-green-50 border-green-100'}`}>
            <h3 className="font-bold mb-2 text-gray-800">Attendance Status</h3>
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-bold ${isAtRisk ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
              {isAtRisk ? '⚠ At Risk' : '✓ Good Standing'}
            </div>
            <div className="mt-3 text-sm space-y-1">
              <p className="text-gray-600">Absences: <strong>{absences}</strong></p>
              <p className="text-gray-600">Lates: <strong>{lates}</strong></p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-bold text-gray-800 mb-3">📝 Quick Note / Anecdotal</h3>
            <div className="space-y-3">
              <select value={noteForm.category} onChange={e => setNoteForm(f => ({ ...f, category: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                <option>General Note</option>
                <option>Academic Concern</option>
                <option>Behavioral</option>
                <option>Health</option>
              </select>
              <textarea
                rows={3} placeholder="Write your observation..."
                value={noteForm.observation} onChange={e => setNoteForm(f => ({ ...f, observation: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
              />
              <button onClick={handleSaveNote} className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 rounded-lg text-sm">+ Save Note</button>
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800">Academic Performance</h3>
              <div className="flex gap-1">
                {[1,2,3,4].map(q => (
                  <button key={q} onClick={() => setActiveQ(q)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${activeQ === q ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                    Q{q}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl p-4 text-white">
                <p className="text-white/70 text-xs uppercase tracking-wide mb-1">Q{activeQ} Average</p>
                <p className={`text-4xl font-black ${avgGrade ? '' : 'text-white/30'}`}>{avgGrade ?? '—'}</p>
                {avgGrade && <p className={`text-xs font-bold mt-1 ${avgGrade >= 75 ? 'text-green-200' : 'text-red-200'}`}>{avgGrade >= 75 ? 'ON TRACK' : 'AT RISK'}</p>}
              </div>
              <div className="border-2 border-dashed border-gray-200 rounded-xl p-4">
                <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">General Final Grade</p>
                <p className="text-4xl font-black text-gray-300">—</p>
                <p className="text-xs text-gray-400 mt-1">Based on all quarters</p>
              </div>
            </div>
            {subjects.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-4">No subjects yet. Add subjects in the Grading section.</p>
            ) : (
              <div className="space-y-2">
                {subjects.map(sub => {
                  const grade = getSubjectGrade(sub.id, activeQ);
                  return (
                    <div key={sub.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center text-xs font-bold text-purple-700">{sub.code.slice(0,3)}</div>
                        <div>
                          <p className="font-semibold text-gray-800 text-sm">{sub.name}</p>
                          <Link href={`/classes/${id}/grading/${sub.id}`} className="text-xs text-blue-500 hover:underline">View Class Record →</Link>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {grade !== null ? (
                          <>
                            <span className={`text-2xl font-black ${gradeColor(grade)}`}>{grade}</span>
                            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${grade >= 75 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{grade >= 75 ? 'PASSED' : 'FAILED'}</span>
                          </>
                        ) : <span className="text-gray-300 font-bold">—</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notes timeline */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-bold text-gray-800 mb-4">Student History & Observations</h3>
            {notes.length === 0 ? (
              <p className="text-gray-400 text-sm italic">No observations recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {[...notes].reverse().map(n => (
                  <div key={n.id} className="border-l-4 border-purple-200 pl-4 py-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${n.category === 'Academic Concern' ? 'bg-red-100 text-red-700' : 'bg-purple-100 text-purple-700'}`}>{n.category.toUpperCase()}</span>
                      <span className="text-xs text-gray-400">{new Date(n.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm text-gray-700">{n.observation}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-gray-400">Logged by teacher</span>
                      <button onClick={() => deleteNote(n.id)} className="text-gray-300 hover:text-red-400 text-xs">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
