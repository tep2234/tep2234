'use client';
import { use, useState, useCallback } from 'react';
import Link from 'next/link';
import { useClasses } from '@/hooks/useClasses';
import { useStudents } from '@/hooks/useStudents';
import { useSubjects } from '@/hooks/useSubjects';
import { useGrades } from '@/hooks/useGrades';
import { calcWS, calcPS, calcFinalGrade } from '@/lib/gradeCalc';
import Avatar from '@/components/ui/Avatar';

interface Props { params: Promise<{ id: string; subjectId: string }> }

const COLS = 10;
type Category = 'WW' | 'PT' | 'QA';

export default function GradebookPage({ params }: Props) {
  const { id, subjectId } = use(params);
  const { getClass } = useClasses();
  const { students } = useStudents(id);
  const { getSubject } = useSubjects(id);
  const { allGrades, upsertGrade } = useGrades(subjectId);
  const [activeQ, setActiveQ] = useState(1);
  const [saving, setSaving] = useState(false);

  const cls = getClass(id);
  const subject = getSubject(subjectId);

  const getScore = useCallback((studentId: string, cat: Category, col: number): number | null => {
    const g = allGrades.find(g => g.subjectId === subjectId && g.studentId === studentId && g.quarter === activeQ && g.category === cat && g.columnIndex === col);
    return g ? g.score : null;
  }, [allGrades, subjectId, activeQ]);

  const handleChange = (studentId: string, cat: Category, col: number, val: string) => {
    const score = val === '' ? null : Number(val);
    setSaving(true);
    upsertGrade({ subjectId, studentId, quarter: activeQ, category: cat, columnIndex: col, score });
    setTimeout(() => setSaving(false), 800);
  };

  // Highest score per column (max across all students)
  const getHighest = (cat: Category, col: number): number => {
    const scores = students.map(s => getScore(s.id, cat, col)).filter((s): s is number => s !== null);
    return scores.length > 0 ? Math.max(...scores) : 0;
  };

  const getStudentTotal = (studentId: string, cat: Category): number =>
    Array.from({ length: COLS }, (_, i) => getScore(studentId, cat, i) ?? 0).reduce((a, b) => a + b, 0);

  const getHighestTotal = (cat: Category): number =>
    Array.from({ length: COLS }, (_, i) => getHighest(cat, i)).reduce((a, b) => a + b, 0);

  const getWS = (studentId: string, cat: Category, weight: number): number => {
    const ht = getHighestTotal(cat);
    if (ht === 0) return 0;
    return (getStudentTotal(studentId, cat) / ht) * weight;
  };

  const getPS = (studentId: string, cat: Category): number => {
    const ht = getHighestTotal(cat);
    if (ht === 0) return 0;
    return (getStudentTotal(studentId, cat) / ht) * 100;
  };

  if (!subject) return <div className="min-h-screen flex items-center justify-center"><p className="text-gray-500">Subject not found.</p></div>;

  const wwWeight = subject.wwWeight;
  const ptWeight = subject.ptWeight;
  const qaWeight = subject.qaWeight;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#0F1629] to-[#1B2035] text-white px-6 py-5">
        <div className="max-w-full mx-auto">
          <Link href={`/classes/${id}/grading`} className="text-white/50 text-sm hover:text-white/80 mb-2 inline-block">← Back to Subjects</Link>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-teal-500 rounded-xl flex items-center justify-center text-white font-bold text-sm">{subject.code.slice(0,2).toUpperCase()}</div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold">{subject.name}</h1>
                  <span className="bg-white/10 text-white/70 text-xs px-2 py-0.5 rounded-full">{cls?.name}</span>
                </div>
                <div className="flex gap-1 mt-1">
                  {[1,2,3,4].map(q => (
                    <button key={q} onClick={() => setActiveQ(q)}
                      className={`px-3 py-0.5 rounded-full text-xs font-bold transition-colors ${activeQ === q ? 'bg-purple-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}>
                      Q{q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {saving && <span className="flex items-center gap-1 text-xs text-green-300"><span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />AUTO-SAVING</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-white border-b border-gray-100 px-6 py-2 flex items-center gap-6 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" />Written Works</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500" />Performance Tasks</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />Quarterly Assessment</span>
        <span className="text-gray-400 ml-auto">ENTER = Move Down · TAB = Move Right</span>
      </div>

      {/* Gradebook table */}
      <div className="flex-1 overflow-auto">
        <table className="min-w-max text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-gray-800 text-white px-4 py-2 min-w-[160px] text-left">Student</th>
              {/* WW */}
              <th colSpan={COLS + 3} className="bg-blue-700 text-white px-2 py-2 text-center border-x border-blue-600">
                WRITTEN WORKS <span className="bg-blue-500/50 px-1.5 py-0.5 rounded text-xs ml-1">{wwWeight}%</span>
              </th>
              {/* PT */}
              <th colSpan={COLS + 3} className="bg-purple-700 text-white px-2 py-2 text-center border-x border-purple-600">
                PERFORMANCE TASKS <span className="bg-purple-500/50 px-1.5 py-0.5 rounded text-xs ml-1">{ptWeight}%</span>
              </th>
              {/* QA */}
              <th colSpan={COLS + 3} className="bg-green-700 text-white px-2 py-2 text-center border-x border-green-600">
                QUARTERLY ASSESSMENT <span className="bg-green-500/50 px-1.5 py-0.5 rounded text-xs ml-1">{qaWeight}%</span>
              </th>
              <th colSpan={2} className="bg-gray-800 text-white px-2 py-2 text-center">GRADE</th>
            </tr>
            <tr>
              <th className="sticky left-0 z-20 bg-gray-700 text-white px-4 py-1.5 text-left text-xs font-normal"></th>
              {(['WW','PT','QA'] as Category[]).flatMap(cat => [
                ...Array.from({ length: COLS }, (_, i) => (
                  <th key={`${cat}-${i}`} className={`px-2 py-1.5 font-normal text-center w-12 ${cat === 'WW' ? 'bg-blue-100 text-blue-800' : cat === 'PT' ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'}`}>{i+1}</th>
                )),
                <th key={`${cat}-tot`} className={`px-2 py-1.5 font-bold text-center w-12 ${cat === 'WW' ? 'bg-blue-200 text-blue-900' : cat === 'PT' ? 'bg-purple-200 text-purple-900' : 'bg-green-200 text-green-900'}`}>TOT</th>,
                <th key={`${cat}-ps`} className={`px-2 py-1.5 font-bold text-center w-12 ${cat === 'WW' ? 'bg-blue-200 text-blue-900' : cat === 'PT' ? 'bg-purple-200 text-purple-900' : 'bg-green-200 text-green-900'}`}>PS</th>,
                <th key={`${cat}-ws`} className="bg-yellow-100 text-yellow-800 px-2 py-1.5 font-bold text-center w-12">WS</th>,
              ])}
              <th className="bg-gray-700 text-white px-2 py-1.5 font-bold text-center w-14">INIT</th>
              <th className="bg-gray-900 text-white px-2 py-1.5 font-bold text-center w-14">FINAL</th>
            </tr>
            {/* Highest Score Row */}
            <tr className="bg-yellow-50">
              <td className="sticky left-0 z-20 bg-yellow-100 px-4 py-2 font-bold text-yellow-800 text-xs">HIGHEST</td>
              {(['WW','PT','QA'] as Category[]).flatMap(cat => [
                ...Array.from({ length: COLS }, (_, i) => (
                  <td key={`h-${cat}-${i}`} className="px-2 py-2 text-center font-bold text-yellow-700 border-r border-yellow-200">{getHighest(cat, i) || '—'}</td>
                )),
                <td key={`h-${cat}-tot`} className="px-2 py-2 text-center font-bold text-yellow-800 border-r border-yellow-200">{getHighestTotal(cat) || '—'}</td>,
                <td key={`h-${cat}-ps`} className="px-2 py-2 text-center text-yellow-600 border-r border-yellow-200">100</td>,
                <td key={`h-${cat}-ws`} className="bg-yellow-200 px-2 py-2 text-center font-bold text-yellow-900 border-r border-yellow-300">{(cat === 'WW' ? wwWeight : cat === 'PT' ? ptWeight : qaWeight).toFixed(0)}</td>,
              ])}
              <td className="px-2 py-2 text-center text-gray-400">—</td>
              <td className="px-2 py-2 text-center text-gray-400">—</td>
            </tr>
          </thead>
          <tbody>
            {students.map((s, si) => {
              const wwWS = getWS(s.id, 'WW', wwWeight);
              const ptWS = getWS(s.id, 'PT', ptWeight);
              const qaWS = getWS(s.id, 'QA', qaWeight);
              const initial = calcFinalGrade(wwWS, ptWS, qaWS);
              const gradeColor = initial >= 90 ? 'text-green-700' : initial >= 75 ? 'text-blue-700' : 'text-red-700';

              return (
                <tr key={s.id} className={`border-b border-gray-100 ${si % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'} hover:bg-blue-50/20`}>
                  <td className="sticky left-0 z-10 bg-inherit px-3 py-2 min-w-[160px]">
                    <div className="flex items-center gap-2">
                      <Avatar firstName={s.firstName} lastName={s.lastName} size="sm" />
                      <span className="font-semibold text-gray-800 text-xs">{s.lastName}, {s.firstName.charAt(0)}.</span>
                    </div>
                  </td>
                  {(['WW','PT','QA'] as Category[]).flatMap(cat => {
                    const tot = getStudentTotal(s.id, cat);
                    const ht = getHighestTotal(cat);
                    const ps = ht > 0 ? (tot / ht * 100).toFixed(1) : '0.0';
                    const ws = ht > 0 ? ((tot / ht) * (cat === 'WW' ? wwWeight : cat === 'PT' ? ptWeight : qaWeight)).toFixed(2) : '0.00';
                    return [
                      ...Array.from({ length: COLS }, (_, i) => (
                        <td key={`${s.id}-${cat}-${i}`} className={`grade-cell p-0 w-12 h-9 ${cat === 'WW' ? 'border-r border-blue-50' : cat === 'PT' ? 'border-r border-purple-50' : 'border-r border-green-50'}`}>
                          <input
                            type="number" min={0}
                            defaultValue={getScore(s.id, cat, i) ?? ''}
                            onBlur={e => handleChange(s.id, cat, i, e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                            className="w-full h-full text-center text-xs border-none outline-none bg-transparent p-1"
                          />
                        </td>
                      )),
                      <td key={`${s.id}-${cat}-tot`} className={`px-2 py-2 text-center text-xs font-bold ${cat === 'WW' ? 'bg-blue-50 text-blue-800' : cat === 'PT' ? 'bg-purple-50 text-purple-800' : 'bg-green-50 text-green-800'}`}>{tot || '—'}</td>,
                      <td key={`${s.id}-${cat}-ps`} className={`px-2 py-2 text-center text-xs ${cat === 'WW' ? 'bg-blue-50 text-blue-700' : cat === 'PT' ? 'bg-purple-50 text-purple-700' : 'bg-green-50 text-green-700'}`}>{ps}</td>,
                      <td key={`${s.id}-${cat}-ws`} className="bg-yellow-50 px-2 py-2 text-center text-xs font-bold text-yellow-800">{ws}</td>,
                    ];
                  })}
                  <td className={`px-2 py-2 text-center text-sm font-bold ${gradeColor}`}>{initial || '—'}</td>
                  <td className={`bg-gray-50 px-2 py-2 text-center text-sm font-black ${gradeColor}`}>{initial || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
