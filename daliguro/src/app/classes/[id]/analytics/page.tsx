'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useClasses } from '@/hooks/useClasses';
import { useStudents } from '@/hooks/useStudents';
import { useSubjects } from '@/hooks/useSubjects';
import { useGrades } from '@/hooks/useGrades';
import { calcFinalGrade, calcWS } from '@/lib/gradeCalc';

interface Props { params: Promise<{ id: string }> }

const COLS = 10;
type Category = 'WW' | 'PT' | 'QA';

export default function AnalyticsPage({ params }: Props) {
  const { id } = use(params);
  const { getClass } = useClasses();
  const { students } = useStudents(id);
  const { subjects } = useSubjects(id);
  const { allGrades } = useGrades();
  const cls = getClass(id);
  const [activeQ, setActiveQ] = useState(1);
  const [aiExpanded, setAiExpanded] = useState(false);

  const getStudentGrade = (studentId: string, subjectId: string, quarter: number): number => {
    const subject = subjects.find(s => s.id === subjectId);
    if (!subject) return 0;
    const grades = allGrades.filter(g => g.subjectId === subjectId && g.studentId === studentId && g.quarter === quarter);
    const getTotal = (cat: Category) => grades.filter(g => g.category === cat).reduce((a, g) => a + (g.score ?? 0), 0);
    const getHighestTotal = (cat: Category) => {
      const allCatGrades = allGrades.filter(g => g.subjectId === subjectId && g.quarter === quarter && g.category === cat);
      const cols = new Set(allCatGrades.map(g => g.columnIndex));
      return Array.from(cols).reduce((a, ci) => {
        const max = Math.max(...allCatGrades.filter(g => g.columnIndex === ci).map(g => g.score ?? 0));
        return a + max;
      }, 0);
    };
    const getWS2 = (cat: Category, weight: number) => {
      const ht = getHighestTotal(cat);
      if (ht === 0) return 0;
      return (getTotal(cat) / ht) * weight;
    };
    return calcFinalGrade(getWS2('WW', subject.wwWeight), getWS2('PT', subject.ptWeight), getWS2('QA', subject.qaWeight));
  };

  const subjectAverages = subjects.map(sub => {
    const grades = students.map(s => getStudentGrade(s.id, sub.id, activeQ)).filter(g => g > 0);
    const avg = grades.length > 0 ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length) : 0;
    return { sub, avg };
  });

  const allStudentGrades = students.map(s => {
    const grades = subjects.map(sub => getStudentGrade(s.id, sub.id, activeQ)).filter(g => g > 0);
    const avg = grades.length > 0 ? Math.round(grades.reduce((a, b) => a + b, 0) / grades.length) : 0;
    return { s, avg, subGrades: subjects.map(sub => ({ sub, grade: getStudentGrade(s.id, sub.id, activeQ) })) };
  });

  const dist = {
    excellent: allStudentGrades.filter(x => x.avg >= 90).length,
    veryGood: allStudentGrades.filter(x => x.avg >= 85 && x.avg < 90).length,
    good: allStudentGrades.filter(x => x.avg >= 80 && x.avg < 85).length,
    fair: allStudentGrades.filter(x => x.avg >= 75 && x.avg < 80).length,
    failed: allStudentGrades.filter(x => x.avg > 0 && x.avg < 75).length,
  };
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  const pct = (n: number) => total > 0 ? Math.round((n / total) * 100) : 0;

  const atRisk = allStudentGrades.filter(x => x.subGrades.some(g => g.grade > 0 && g.grade < 75));
  const honors = allStudentGrades.filter(x => x.avg >= 90);
  const maxAvg = Math.max(...subjectAverages.map(x => x.avg), 1);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-r from-[#0F1629] to-[#1B2035] text-white px-6 py-6">
        <div className="max-w-5xl mx-auto">
          <Link href={`/classes/${id}`} className="text-white/50 text-sm hover:text-white/80 mb-2 inline-block">← Back to Class Hub</Link>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">Academic Performance</h1>
              <p className="text-white/50 text-sm">Analyzing grades for {cls?.name}</p>
            </div>
            <div className="flex gap-1">
              {[1,2,3,4].map(q => (
                <button key={q} onClick={() => setActiveQ(q)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${activeQ === q ? 'bg-purple-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}>
                  Q{q}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* AI Panel */}
        <div className="bg-gradient-to-br from-purple-900 to-indigo-900 rounded-xl p-5 text-white">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">🤖</span>
              <h3 className="font-bold">AI Executive Summary</h3>
              <span className="bg-purple-500/50 text-purple-200 text-xs px-2 py-0.5 rounded-full font-bold">BETA</span>
            </div>
            <button onClick={() => setAiExpanded(!aiExpanded)} className="bg-white/10 hover:bg-white/20 text-white font-semibold px-4 py-1.5 rounded-lg text-sm">
              {aiExpanded ? 'Hide' : 'Generate Insights'}
            </button>
          </div>
          {aiExpanded && (
            <div className="bg-white/10 rounded-lg p-4 text-sm text-white/80">
              <p className="mb-2">📊 <strong>Class Performance Summary for Q{activeQ}:</strong></p>
              <ul className="space-y-1 list-disc ml-4">
                <li>{students.length} students enrolled, {total} with recorded grades</li>
                <li>{honors.length} students ({pct(honors.length)}%) achieved honors (90+)</li>
                <li>{dist.failed} students ({pct(dist.failed)}%) are at risk of failing</li>
                <li>Class passing rate: {total > 0 ? pct(total - dist.failed) : 0}%</li>
              </ul>
              <p className="mt-3 text-white/50 text-xs">⚠ Privacy: All data is stored locally. No data is sent to external servers.</p>
            </div>
          )}
          {!aiExpanded && <p className="text-white/40 text-xs">Click Generate Insights to view AI-powered class analysis.</p>}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-red-50 border border-red-100 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">⚠️</span>
              <h4 className="font-bold text-red-700">At Risk</h4>
            </div>
            <p className="text-4xl font-black text-red-600">{atRisk.length}</p>
            <p className="text-red-500 text-sm">students with failing grades (&lt;75)</p>
          </div>
          <div className="bg-green-50 border border-green-100 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">🏆</span>
              <h4 className="font-bold text-green-700">Honors</h4>
            </div>
            <p className="text-4xl font-black text-green-600">{honors.length}</p>
            <p className="text-green-500 text-sm">students scoring 90+</p>
          </div>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Subject Performance */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-bold text-gray-800 mb-4">Subject Performance Index</h3>
            {subjectAverages.length === 0 ? (
              <p className="text-gray-400 text-sm italic">No subjects yet.</p>
            ) : (
              <div className="space-y-3">
                {subjectAverages.map(({ sub, avg }) => (
                  <div key={sub.id}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700">{sub.code}</span>
                      <span className={`font-bold ${avg >= 90 ? 'text-green-600' : avg >= 75 ? 'text-blue-600' : 'text-red-600'}`}>{avg || '—'}</span>
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${avg >= 90 ? 'bg-green-500' : avg >= 75 ? 'bg-blue-500' : 'bg-red-500'}`}
                        style={{ width: `${(avg / 100) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Grade Distribution Donut */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
            <h3 className="font-bold text-gray-800 mb-4">Grade Distribution</h3>
            <div className="flex items-center gap-6">
              {/* Simple donut */}
              <div className="relative w-28 h-28 flex-shrink-0">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  {(() => {
                    const segments = [
                      { value: dist.excellent, color: '#10B981' },
                      { value: dist.veryGood, color: '#3B82F6' },
                      { value: dist.good, color: '#F59E0B' },
                      { value: dist.fair, color: '#F97316' },
                      { value: dist.failed, color: '#EF4444' },
                    ];
                    let offset = 0;
                    return segments.map((seg, i) => {
                      const pct2 = total > 0 ? seg.value / total : 0;
                      const el = (
                        <circle key={i} cx="18" cy="18" r="15.9"
                          fill="transparent" stroke={seg.color} strokeWidth="3.2"
                          strokeDasharray={`${pct2 * 100} ${100 - pct2 * 100}`}
                          strokeDashoffset={-offset}
                        />
                      );
                      offset += pct2 * 100;
                      return el;
                    });
                  })()}
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-black text-gray-700">{total}</span>
                </div>
              </div>
              <div className="space-y-1.5 text-xs flex-1">
                {[
                  { label: '90+ Excellent', count: dist.excellent, color: 'bg-green-500' },
                  { label: '85–89 Very Good', count: dist.veryGood, color: 'bg-blue-500' },
                  { label: '80–84 Good', count: dist.good, color: 'bg-amber-500' },
                  { label: '75–79 Fair', count: dist.fair, color: 'bg-orange-500' },
                  { label: '<75 Failed', count: dist.failed, color: 'bg-red-500' },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${item.color}`} />
                    <span className="text-gray-600 flex-1">{item.label}</span>
                    <span className="font-bold text-gray-800">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Intervention Watchlist */}
        {atRisk.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 bg-red-50">
              <h3 className="font-bold text-red-700">🚨 Intervention Watchlist</h3>
              <p className="text-red-500 text-sm">Students with failing grades who need immediate attention</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 font-semibold text-gray-600">Student</th>
                  <th className="text-left px-5 py-3 font-semibold text-gray-600">Failing Subjects</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {atRisk.map(({ s, subGrades }) => (
                  <tr key={s.id} className="border-b border-gray-50">
                    <td className="px-5 py-3 font-semibold text-gray-800">{s.lastName}, {s.firstName}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {subGrades.filter(g => g.grade > 0 && g.grade < 75).map(g => (
                          <span key={g.sub.id} className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">
                            {g.sub.code}: {g.grade}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Link href={`/classes/${id}/students/${s.id}`} className="text-purple-600 hover:underline text-sm font-semibold">View Profile →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
