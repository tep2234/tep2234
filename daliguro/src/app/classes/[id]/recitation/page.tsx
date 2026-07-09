'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useClasses } from '@/hooks/useClasses';
import { useStudents } from '@/hooks/useStudents';
import { useSubjects } from '@/hooks/useSubjects';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

interface Props { params: Promise<{ id: string }> }

interface Session {
  id: string; topic: string; subject: string; date: string; status: 'draft' | 'active' | 'completed';
  questions: { id: string; question: string; expectedAnswer: string }[];
  scores: { studentId: string; studentName: string; points: number }[];
}

function generateQuestions(topic: string, subject: string, count: number) {
  return Array.from({ length: Math.min(count, 8) }, (_, i) => ({
    id: `q${i}`,
    question: `Question ${i + 1}: Explain a key concept related to "${topic || subject}".`,
    expectedAnswer: `Expected: A clear explanation demonstrating understanding of ${topic || subject}.`,
  }));
}

type PageState = 'list' | 'create' | 'review' | 'live' | 'complete';

export default function RecitationPage({ params }: Props) {
  const { id } = use(params);
  const { getClass } = useClasses();
  const { students } = useStudents(id);
  const { subjects } = useSubjects(id);
  const cls = getClass(id);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [pageState, setPageState] = useState<PageState>('list');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);

  // Live presentation state
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [revealAnswer, setRevealAnswer] = useState(false);
  const [calledStudent, setCalledStudent] = useState<{ id: string; name: string } | null>(null);
  const [liveScores, setLiveScores] = useState<Record<string, number>>({});
  const [customScore, setCustomScore] = useState('');
  const [scoreSynced, setScoreSynced] = useState(false);

  const [form, setForm] = useState({ subjectId: '', topic: '', instructions: '', questions: students.length + 10, maxScore: 10 });

  const handleGenerateSession = () => {
    const sub = subjects.find(s => s.id === form.subjectId);
    const questions = generateQuestions(form.topic, sub?.name || 'Subject', form.questions);
    const newSession: Session = {
      id: Date.now().toString(),
      topic: form.topic || `${sub?.name} Recitation`,
      subject: sub?.name || 'Unknown',
      date: new Date().toISOString(),
      status: 'draft',
      questions,
      scores: students.map(s => ({ studentId: s.id, studentName: `${s.lastName}, ${s.firstName}`, points: 0 })),
    };
    setSessions(prev => [...prev, newSession]);
    setCurrentSession(newSession);
    setShowStartModal(false);
    setPageState('review');
  };

  const handleLaunch = (session: Session) => {
    const updated = { ...session, status: 'active' as const };
    setSessions(prev => prev.map(s => s.id === session.id ? updated : s));
    setCurrentSession(updated);
    setCurrentQIndex(0);
    setRevealAnswer(false);
    setCalledStudent(null);
    setLiveScores({});
    setPageState('live');
  };

  const randomizeStudent = () => {
    const idx = Math.floor(Math.random() * students.length);
    const s = students[idx];
    setCalledStudent({ id: s.id, name: `${s.lastName}, ${s.firstName}` });
  };

  const handleScore = (pts: number) => {
    if (!calledStudent) return;
    setLiveScores(prev => ({ ...prev, [calledStudent.id]: (prev[calledStudent.id] || 0) + pts }));
    setScoreSynced(true);
    setTimeout(() => setScoreSynced(false), 1500);
  };

  const maxPts = form.maxScore;
  const sortedLeaderboard = [...students]
    .map(s => ({ s, pts: liveScores[s.id] || 0 }))
    .sort((a, b) => b.pts - a.pts);

  const handleEndSession = () => {
    if (currentSession) {
      setSessions(prev => prev.map(s => s.id === currentSession.id ? { ...s, status: 'completed' } : s));
    }
    setPageState('complete');
  };

  if (pageState === 'live' && currentSession) {
    const q = currentSession.questions[currentQIndex];
    return (
      <div className="min-h-screen bg-gray-900 text-white flex flex-col">
        <div className="bg-orange-500/20 border-b border-orange-500/30 px-6 py-2 text-center text-xs font-bold text-orange-300 uppercase tracking-widest">
          📡 PROJECTOR MODE — Students can see this screen
        </div>
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Question */}
          <div className="flex-1 flex flex-col p-8">
            <div className="mb-4 flex items-center gap-3">
              <span className="bg-white/10 text-white/60 text-xs px-3 py-1 rounded-full">{currentSession.subject}</span>
              <span className="text-white/40 text-sm">Question {currentQIndex + 1} of {currentSession.questions.length}</span>
            </div>
            <div className="flex-1 bg-white/5 rounded-2xl p-8 flex items-center justify-center mb-6">
              <p className="text-xl font-bold text-white text-center">{q?.question || 'End of questions'}</p>
            </div>
            {revealAnswer && q && (
              <div className="bg-green-500/20 border border-green-500/30 rounded-xl p-4 mb-4">
                <p className="text-green-300 text-sm"><strong>Expected Answer:</strong> {q.expectedAnswer}</p>
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={handleEndSession} className="bg-red-500/20 hover:bg-red-500/30 text-red-300 px-4 py-2 rounded-lg text-sm font-semibold">End Early</button>
              {currentQIndex < currentSession.questions.length - 1 && (
                <button onClick={() => { setCurrentQIndex(i => i + 1); setRevealAnswer(false); }} className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-semibold">Skip Question</button>
              )}
              <button onClick={() => setRevealAnswer(!revealAnswer)} className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 px-4 py-2 rounded-lg text-sm font-semibold">
                {revealAnswer ? 'Hide Answer' : 'Reveal Answer'}
              </button>
            </div>
          </div>

          {/* Center: Called student + scoring */}
          <div className="w-72 bg-gray-800 flex flex-col p-5 gap-4">
            <div className="bg-gray-900 rounded-xl p-4">
              <p className="text-white/40 text-xs uppercase tracking-wide mb-2">CURRENTLY CALLING</p>
              {calledStudent ? (
                <p className="text-white font-bold text-lg">{calledStudent.name}</p>
              ) : (
                <p className="text-white/30 text-sm italic">No student selected</p>
              )}
              <button onClick={randomizeStudent} className="mt-3 w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 rounded-lg text-sm">🎲 RANDOMIZE STUDENT</button>
            </div>
            {calledStudent && (
              <div className="space-y-2">
                <p className="text-white/40 text-xs uppercase tracking-wide">Score</p>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => handleScore(0)} className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 rounded-lg text-xs">0 PTS</button>
                  <button onClick={() => handleScore(Math.floor(maxPts / 2))} className="bg-amber-500/30 hover:bg-amber-500/50 text-amber-300 font-bold py-2 rounded-lg text-xs">HALF</button>
                  <button onClick={() => handleScore(maxPts)} className="bg-green-500/30 hover:bg-green-500/50 text-green-300 font-bold py-2 rounded-lg text-xs">{maxPts} PTS</button>
                </div>
                <div className="flex gap-2">
                  <input type="number" min={0} max={maxPts} value={customScore} onChange={e => setCustomScore(e.target.value)} placeholder="Custom" className="flex-1 bg-gray-700 text-white border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-center" />
                  <button onClick={() => { if (customScore) { handleScore(Number(customScore)); setCustomScore(''); } }} className="bg-purple-600 hover:bg-purple-700 text-white px-3 rounded-lg text-sm font-bold">SAVE</button>
                </div>
                {scoreSynced && <p className="text-green-400 text-xs text-center font-bold animate-pulse">✓ Score Synced!</p>}
              </div>
            )}
          </div>

          {/* Right: Leaderboard */}
          <div className="w-56 bg-gray-800/50 p-4">
            <p className="text-white/60 text-xs uppercase tracking-wide mb-3">🏆 Live Leaderboard</p>
            <div className="space-y-2">
              {sortedLeaderboard.slice(0, 10).map(({ s, pts }, rank) => (
                <div key={s.id} className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${rank === 0 ? 'bg-yellow-500/20 text-yellow-200' : 'bg-white/5 text-white/70'}`}>
                  <span className="text-white/40 w-5">{rank + 1}.</span>
                  <span className="flex-1 font-medium">{s.firstName}</span>
                  <span className="font-bold">{pts}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (pageState === 'complete') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h2 className="text-3xl font-black text-white mb-2">Session Complete!</h2>
          <p className="text-white/50 mb-8">Great recitation session!</p>
          <div className="bg-white/10 rounded-xl p-6 mb-6 min-w-64">
            <p className="text-white/60 text-sm uppercase tracking-wide mb-3">Final Leaderboard</p>
            <div className="space-y-2">
              {sortedLeaderboard.slice(0, 5).map(({ s, pts }, rank) => (
                <div key={s.id} className="flex items-center justify-between text-white">
                  <span className="text-white/40 w-6">{rank + 1}.</span>
                  <span className="flex-1">{s.firstName}</span>
                  <span className="font-bold">{pts} pts</span>
                </div>
              ))}
            </div>
          </div>
          <button onClick={() => setPageState('list')} className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-8 py-3 rounded-xl">
            View Grades in Gradebook →
          </button>
        </div>
      </div>
    );
  }

  if (pageState === 'review' && currentSession) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-gradient-to-r from-[#0F1629] to-[#1B2035] text-white px-6 py-6">
          <div className="max-w-3xl mx-auto">
            <button onClick={() => setPageState('list')} className="text-white/50 text-sm hover:text-white/80 mb-2 inline-block">← Back to Sessions</button>
            <h1 className="text-2xl font-bold">{currentSession.topic}</h1>
            <p className="text-white/50 text-sm">{currentSession.subject} · {currentSession.questions.length} questions</p>
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
          {currentSession.questions.map((q, i) => (
            <div key={q.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <div className="flex items-start justify-between">
                <p className="font-semibold text-gray-800">{i + 1}. {q.question}</p>
                <button className="text-gray-300 hover:text-red-400 ml-3">🗑</button>
              </div>
              <div className="mt-3 bg-green-50 border border-green-100 rounded-lg p-3 text-sm text-green-700">
                <strong>Expected Answer:</strong> {q.expectedAnswer}
              </div>
            </div>
          ))}
          <div className="flex gap-3 justify-end pt-2">
            <button onClick={() => setPageState('list')} className="border border-gray-200 bg-white text-gray-700 font-semibold px-5 py-2.5 rounded-xl text-sm">Save & Launch Later</button>
            <button onClick={() => handleLaunch(currentSession)} className="bg-red-500 hover:bg-red-600 text-white font-semibold px-6 py-2.5 rounded-xl text-sm">🚀 Launch Presentation</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-red-900 to-rose-800 text-white px-6 py-8">
        <div className="max-w-5xl mx-auto">
          <Link href={`/classes/${id}`} className="text-white/50 text-sm hover:text-white/80 mb-2 inline-block">← Back to Class Hub</Link>
          <div className="flex items-start justify-between">
            <div>
              <span className="bg-white/10 text-white/70 text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">AI-POWERED TOOL</span>
              <h1 className="text-3xl font-black mt-2">Gamified Recitation</h1>
              <p className="text-white/60 mt-1">Turn oral recitations into an interactive live presentation with real-time scoring.</p>
            </div>
            <button onClick={() => setShowCreateModal(true)} className="bg-white text-red-800 hover:bg-red-50 font-bold px-5 py-2.5 rounded-xl text-sm">+ Start New Session</button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {sessions.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-6xl mb-4">👻</div>
            <h3 className="text-xl font-bold text-gray-700 mb-2">No sessions yet</h3>
            <p className="text-gray-400 mb-6">Start your first gamified recitation session.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  {['Topic', 'Subject', 'Date', 'Status', 'Action'].map(h => (
                    <th key={h} className="text-left px-5 py-3 font-semibold text-gray-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id} className="border-b border-gray-50">
                    <td className="px-5 py-3 font-semibold text-gray-800">{s.topic}</td>
                    <td className="px-5 py-3 text-gray-600">{s.subject}</td>
                    <td className="px-5 py-3 text-gray-500">{new Date(s.date).toLocaleDateString()}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${s.status === 'completed' ? 'bg-green-100 text-green-700' : s.status === 'active' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                        {s.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {s.status === 'draft' && (
                        <button onClick={() => { setCurrentSession(s); setPageState('review'); }} className="text-purple-600 hover:underline font-semibold text-sm">Review →</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Method Modal */}
      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create New Session" size="sm">
        <div className="grid grid-cols-2 gap-4">
          <button onClick={() => { setShowCreateModal(false); setShowStartModal(true); }}
            className="border-2 border-green-200 hover:border-green-400 bg-green-50 rounded-xl p-4 text-left">
            <div className="text-2xl mb-2">📋</div>
            <p className="font-bold text-gray-800 text-sm">Write Manually</p>
            <p className="text-gray-500 text-xs mt-1">Set up your own questions and topic</p>
          </button>
          <button className="border-2 border-gray-100 hover:border-gray-200 bg-white rounded-xl p-4 text-left opacity-50 cursor-not-allowed">
            <div className="text-2xl mb-2">📓</div>
            <p className="font-bold text-gray-800 text-sm">From Lesson Log</p>
            <p className="text-gray-500 text-xs mt-1">Coming soon</p>
          </button>
        </div>
      </Modal>

      {/* Start AI Recitation Modal */}
      <Modal open={showStartModal} onClose={() => setShowStartModal(false)} title="Start AI Recitation" size="md">
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-orange-500 to-red-500 rounded-xl p-4 text-white -mx-0">
            <p className="font-bold text-sm">🤖 AI-Powered Question Generator</p>
            <p className="text-white/70 text-xs mt-1">Questions will be generated based on your subject and topic.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Subject</label>
            <select value={form.subjectId} onChange={e => setForm(f => ({ ...f, subjectId: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400">
              <option value="">Select subject...</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Topic (optional)</label>
            <input value={form.topic} onChange={e => setForm(f => ({ ...f, topic: e.target.value }))} placeholder="e.g. Quadratic Equations"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Questions ({students.length} + buffer)</label>
              <input type="number" min={5} value={form.questions} onChange={e => setForm(f => ({ ...f, questions: Number(e.target.value) }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Max Score (per student)</label>
              <input type="number" min={1} value={form.maxScore} onChange={e => setForm(f => ({ ...f, maxScore: Number(e.target.value) }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
            </div>
          </div>
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs text-blue-700">
            ℹ️ <strong>Built-in Question Buffer:</strong> Extra questions ensure you never run out during the session.
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowStartModal(false)}>Cancel</Button>
            <Button variant="danger" onClick={handleGenerateSession} disabled={!form.subjectId}>Generate & Start</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
