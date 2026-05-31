'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useClasses } from '@/hooks/useClasses';
import { useStudents } from '@/hooks/useStudents';
import { useAttendance } from '@/hooks/useAttendance';

interface Props { params: Promise<{ id: string }> }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function AttendancePage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const { getClass } = useClasses();
  const { students } = useStudents(id);
  const { records, getAbsenceCount, getLateCount, hasRecordForDate } = useAttendance(id);
  const cls = getClass(id);

  const today = new Date();
  const [viewDate, setViewDate] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [filterStudent, setFilterStudent] = useState<string>('');

  const { year, month } = viewDate;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonth = () => setViewDate(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 });
  const nextMonth = () => setViewDate(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 });
  const goToday = () => setViewDate({ year: today.getFullYear(), month: today.getMonth() });

  const padDate = (n: number) => String(n).padStart(2, '0');
  const formatDate = (d: number) => `${year}-${padDate(month + 1)}-${padDate(d)}`;
  const isToday = (d: number) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
  const isPast = (d: number) => new Date(year, month, d) <= today;

  const atRisk3Plus = students.filter(s => getAbsenceCount(s.id) >= 3);
  const late6Plus = students.filter(s => getLateCount(s.id) >= 6);

  const getStudentStatus = (studentId: string, date: string) => {
    const rec = records.find(r => r.studentId === studentId && r.date === date);
    if (!rec) return null;
    if (rec.late) return 'late';
    if (rec.present) return 'present';
    return 'absent';
  };

  const cells = Array.from({ length: 42 }, (_, i) => {
    const day = i - firstDay + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-r from-[#0F1629] to-[#1B2035] text-white px-6 py-6">
        <div className="max-w-6xl mx-auto">
          <Link href={`/classes/${id}`} className="text-white/50 text-sm hover:text-white/80 mb-2 inline-block">← Back to Class Overview / Attendance</Link>
          <div className="flex items-start justify-between">
            <div>
              <span className="bg-white/10 text-white/70 text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">Attendance Tracker</span>
              <h1 className="text-2xl font-bold mt-1">{MONTHS[month]} {year}</h1>
              <p className="text-white/50 text-sm">Tracking daily attendance for {cls?.name}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={prevMonth} className="bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm">←</button>
              <button onClick={goToday} className="bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm">Today</button>
              <button onClick={nextMonth} className="bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-sm">→</button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 flex gap-6">
        {/* Calendar */}
        <div className="flex-1">
          <div className="flex items-center justify-between mb-4">
            <select value={filterStudent} onChange={e => setFilterStudent(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-400">
              <option value="">Whole Class</option>
              {students.map(s => <option key={s.id} value={s.id}>{s.lastName}, {s.firstName}</option>)}
            </select>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-100">
              {DAYS.map(d => (
                <div key={d} className="text-center text-xs font-bold text-gray-400 py-3">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((day, i) => {
                if (!day) return <div key={i} className="border-b border-r border-gray-50 min-h-[80px]" />;
                const dateStr = formatDate(day);
                const hasRecord = hasRecordForDate(dateStr);
                const todayCell = isToday(day);
                const past = isPast(day);

                return (
                  <div key={i} className={`border-b border-r border-gray-50 min-h-[80px] p-2 relative group ${todayCell ? 'bg-purple-50' : ''}`}>
                    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-semibold mb-1 ${todayCell ? 'bg-purple-600 text-white' : 'text-gray-600'}`}>{day}</span>
                    {filterStudent ? (
                      // Per-student view
                      <div>
                        {(() => {
                          const status = getStudentStatus(filterStudent, dateStr);
                          if (status === 'present') return <span className="block text-xs bg-green-100 text-green-700 font-bold px-2 py-0.5 rounded-full text-center">P PRESENT</span>;
                          if (status === 'late') return <span className="block text-xs bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full text-center">L LATE</span>;
                          if (past) return <span className="block text-xs text-gray-300 text-center">NO RECORD</span>;
                          return null;
                        })()}
                      </div>
                    ) : (
                      <div>
                        {hasRecord ? (
                          <button
                            onClick={() => router.push(`/classes/${id}/attendance/${dateStr}`)}
                            className="block w-full text-xs bg-purple-100 text-purple-700 font-bold px-2 py-1 rounded-full text-center hover:bg-purple-200"
                          >✓ VIEW</button>
                        ) : past && (
                          <button
                            onClick={() => router.push(`/classes/${id}/attendance/${dateStr}`)}
                            className="block w-full text-xs border border-dashed border-gray-200 text-gray-300 hover:text-gray-500 hover:border-gray-400 px-2 py-1 rounded-full text-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >+ TAKE</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right panel alerts */}
        <div className="w-64 space-y-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h4 className="font-bold text-red-600 text-sm mb-3">⚠ 3+ Absences Alert</h4>
            {atRisk3Plus.length === 0 ? (
              <p className="text-gray-400 text-xs italic">No alerts</p>
            ) : (
              <div className="space-y-2">
                {atRisk3Plus.map(s => (
                  <div key={s.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{s.lastName}, {s.firstName.charAt(0)}.</span>
                    <span className="bg-red-100 text-red-700 text-xs font-bold px-1.5 py-0.5 rounded-full">{getAbsenceCount(s.id)}×</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h4 className="font-bold text-amber-600 text-sm mb-3">⏰ 6+ Lates Alert</h4>
            {late6Plus.length === 0 ? (
              <p className="text-gray-400 text-xs italic">No alerts</p>
            ) : (
              <div className="space-y-2">
                {late6Plus.map(s => (
                  <div key={s.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700">{s.lastName}, {s.firstName.charAt(0)}.</span>
                    <span className="bg-amber-100 text-amber-700 text-xs font-bold px-1.5 py-0.5 rounded-full">{getLateCount(s.id)}×</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
