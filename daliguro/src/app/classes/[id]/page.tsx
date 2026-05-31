'use client';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useClasses } from '@/hooks/useClasses';
import { useStudents } from '@/hooks/useStudents';
import { useSubjects } from '@/hooks/useSubjects';
import { useAttendance } from '@/hooks/useAttendance';
import { useClassNotes } from '@/hooks/useNotes';
import { useState } from 'react';
import Toast from '@/components/ui/Toast';

interface Props { params: Promise<{ id: string }> }

export default function ClassHubPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const { getClass, deleteClass } = useClasses();
  const { students } = useStudents(id);
  const { subjects } = useSubjects(id);
  const { records } = useAttendance(id);
  const { notes, addNote, deleteNote } = useClassNotes(id);
  const [noteInput, setNoteInput] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const cls = getClass(id);
  if (!cls) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-500">Class not found.</p></div>;
  }

  const studentCount = students.length;
  const subjectCount = subjects.length;
  const attendanceCount = records.length;

  const handleSaveNote = () => {
    if (!noteInput.trim()) return;
    addNote(id, noteInput.trim());
    setNoteInput('');
    setToast('Note saved!');
  };

  const handleDeleteClass = () => {
    if (confirm('Delete this class and all its data?')) {
      deleteClass(id);
      router.push('/');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#0F1629] to-[#1B2035] text-white px-6 py-6">
        <div className="max-w-5xl mx-auto">
          <div className="flex items-start justify-between">
            <div>
              <Link href="/" className="text-white/50 text-sm hover:text-white/80 mb-2 inline-block">← Back to Dashboard</Link>
              <div className="flex items-center gap-2 mb-2">
                <span className="bg-purple-500/30 text-purple-200 text-xs font-bold px-2 py-0.5 rounded-full">{cls.gradLevel}</span>
                <span className="bg-white/10 text-white/70 text-xs font-bold px-2 py-0.5 rounded-full">{cls.program}</span>
              </div>
              <h1 className="text-3xl font-black">{cls.name}</h1>
              <p className="text-white/50 text-sm mt-1">School Year {cls.schoolYear}</p>
            </div>
            <button
              onClick={handleDeleteClass}
              className="bg-red-500/20 hover:bg-red-500/30 text-red-300 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              ⚙ Settings
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Feature cards 2x2 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Students */}
          <Link href={`/classes/${id}/students`} className="bg-white rounded-xl shadow-sm border-t-4 border-teal-500 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-start gap-3 mb-3">
              <span className="text-2xl">👨‍🎓</span>
              <div>
                <h3 className="font-bold text-gray-900">Students</h3>
                <p className="text-gray-500 text-sm">Manage roster, edit profiles, and view LRNs.</p>
              </div>
            </div>
            <div className="text-sm font-semibold text-teal-600">
              {studentCount > 0 ? `${studentCount} Students Enrolled` : 'Start here: Add your first student →'}
            </div>
          </Link>

          {/* Attendance */}
          {studentCount > 0 ? (
            <Link href={`/classes/${id}/attendance`} className="bg-white rounded-xl shadow-sm border-t-4 border-purple-500 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-2xl">📅</span>
                <div>
                  <h3 className="font-bold text-gray-900">Attendance</h3>
                  <p className="text-gray-500 text-sm">Track daily attendance (Form 2), lates, and absences.</p>
                </div>
              </div>
              <div className="text-sm font-semibold text-purple-600">{attendanceCount} Records Tracked</div>
            </Link>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border-t-4 border-purple-300 p-5 opacity-60 cursor-not-allowed">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-2xl">📅</span>
                <div>
                  <h3 className="font-bold text-gray-900">Attendance</h3>
                  <p className="text-gray-500 text-sm">Track daily attendance (Form 2), lates, and absences.</p>
                </div>
              </div>
              <span className="bg-gray-200 text-gray-500 text-xs font-bold px-2 py-1 rounded-full">ADD STUDENTS FIRST</span>
            </div>
          )}

          {/* Grading */}
          {studentCount > 0 ? (
            <Link href={`/classes/${id}/grading`} className="bg-white rounded-xl shadow-sm border-t-4 border-teal-500 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-2xl">📊</span>
                <div>
                  <h3 className="font-bold text-gray-900">Grading System</h3>
                  <p className="text-gray-500 text-sm">Manage subjects, grading sheets, and DepEd forms.</p>
                </div>
              </div>
              <div className="text-sm font-semibold text-teal-600">{subjectCount} Subjects Created</div>
            </Link>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border-t-4 border-teal-300 p-5 opacity-60 cursor-not-allowed">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-2xl">📊</span>
                <div>
                  <h3 className="font-bold text-gray-900">Grading System</h3>
                  <p className="text-gray-500 text-sm">Manage subjects, grading sheets, and DepEd forms.</p>
                </div>
              </div>
              <span className="bg-gray-200 text-gray-500 text-xs font-bold px-2 py-1 rounded-full">ADD STUDENTS FIRST</span>
            </div>
          )}

          {/* Analytics */}
          {studentCount > 0 && subjectCount > 0 ? (
            <Link href={`/classes/${id}/analytics`} className="bg-white rounded-xl shadow-sm border-t-4 border-purple-500 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-2xl">📈</span>
                <div>
                  <h3 className="font-bold text-gray-900">Analytics</h3>
                  <p className="text-gray-500 text-sm">Performance insights, visual reports, and class averages.</p>
                </div>
              </div>
              <div className="text-sm font-semibold text-purple-600">View Performance Reports</div>
            </Link>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border-t-4 border-purple-300 p-5 opacity-60 cursor-not-allowed">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-2xl">📈</span>
                <div>
                  <h3 className="font-bold text-gray-900">Analytics</h3>
                  <p className="text-gray-500 text-sm">Performance insights, visual reports, and class averages.</p>
                </div>
              </div>
              <span className="bg-gray-200 text-gray-500 text-xs font-bold px-2 py-1 rounded-full">ADD STUDENTS FIRST</span>
            </div>
          )}
        </div>

        {/* AI Tools Divider */}
        <div className="flex items-center gap-4">
          <div className="h-px bg-gray-200 flex-1" />
          <span className="text-xs font-bold text-gray-400 tracking-widest">✦ AI-POWERED TOOLS</span>
          <div className="h-px bg-gray-200 flex-1" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className={`bg-white rounded-xl p-5 border border-gray-100 ${subjectCount === 0 ? 'opacity-50' : 'hover:shadow-md transition-shadow'}`}>
            <div className="text-2xl mb-2">📝</div>
            <h4 className="font-bold text-gray-800 mb-1">Daily Lesson Logs</h4>
            <p className="text-gray-500 text-xs">Build your custom matrix and generate lesson plans instantly.</p>
          </div>
          <Link href={`/classes/${id}/assessments`} className={`bg-white rounded-xl p-5 border border-gray-100 ${subjectCount === 0 ? 'opacity-50 pointer-events-none' : 'hover:shadow-md transition-shadow'}`}>
            <div className="text-2xl mb-2">🧩</div>
            <h4 className="font-bold text-gray-800 mb-1">Smart Assessments</h4>
            <p className="text-gray-500 text-xs">Generate comprehensive quizzes and TOS instantly.</p>
          </Link>
          <Link href={`/classes/${id}/recitation`} className={`bg-white rounded-xl p-5 border border-gray-100 ${subjectCount === 0 ? 'opacity-50 pointer-events-none' : 'hover:shadow-md transition-shadow'}`}>
            <div className="text-2xl mb-2">🎮</div>
            <h4 className="font-bold text-gray-800 mb-1">Gamified Recitation</h4>
            <p className="text-gray-500 text-xs">Turn oral recitations into an interactive presentation.</p>
          </Link>
        </div>

        {/* Tip Banner */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
          💡 <strong>Did You Know?</strong> You can bulk import your entire student roster using a CSV file. Go to Students → Bulk Import.
        </div>

        {/* Class Notes */}
        <div>
          <div className="flex items-center gap-4 mb-4">
            <div className="h-px bg-gray-200 flex-1" />
            <span className="text-xs font-bold text-gray-400 tracking-widest">CLASS WORKSPACE</span>
            <div className="h-px bg-gray-200 flex-1" />
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-5">
            <h3 className="font-bold text-amber-900 mb-3">📌 Class Notes & To-Dos</h3>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="Add a note or reminder..."
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveNote()}
                className="flex-1 border border-amber-200 bg-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <button
                onClick={handleSaveNote}
                className="bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-lg text-sm"
              >
                + Save Note
              </button>
            </div>
            {notes.length === 0 ? (
              <p className="text-amber-600/60 text-sm italic">No notes yet. Add your first note above.</p>
            ) : (
              <div className="space-y-2">
                {notes.map(n => (
                  <div key={n.id} className="flex items-start justify-between bg-white rounded-lg px-3 py-2 shadow-sm">
                    <div>
                      <p className="text-sm text-gray-800">{n.note}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{new Date(n.createdAt).toLocaleString()}</p>
                    </div>
                    <button onClick={() => deleteNote(n.id)} className="text-gray-300 hover:text-red-400 ml-3 text-sm">✕</button>
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
