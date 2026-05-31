'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useClasses } from '@/hooks/useClasses';
import { useSubjects } from '@/hooks/useSubjects';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';

interface Props { params: Promise<{ id: string }> }

interface MockAssessment {
  id: string;
  subject: string;
  quarter: number;
  type: string;
  items: number;
  createdAt: string;
}

interface MockQuestion {
  number: number;
  question: string;
  choices: string[];
  answer: string;
}

function generateMockQuestions(subject: string, type: string, items: number): MockQuestion[] {
  const topics = ['Definition and Concepts', 'Application Problems', 'Analysis Questions', 'Evaluation Items'];
  return Array.from({ length: Math.min(items, 10) }, (_, i) => ({
    number: i + 1,
    question: `Question ${i + 1}: Which of the following best describes a key concept in ${subject}?`,
    choices: ['A. First option', 'B. Second option', 'C. Third option', 'D. Fourth option'],
    answer: 'B. Second option',
  }));
}

export default function AssessmentsPage({ params }: Props) {
  const { id } = use(params);
  const { getClass } = useClasses();
  const { subjects } = useSubjects(id);
  const cls = getClass(id);
  const [assessments, setAssessments] = useState<MockAssessment[]>([]);
  const [showGenerate, setShowGenerate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [showAnswers, setShowAnswers] = useState(false);
  const [form, setForm] = useState({ subjectId: '', quarter: 1, items: 50, type: 'Quarterly Exam' });

  const handleGenerate = () => {
    setLoading(true);
    setTimeout(() => {
      const sub = subjects.find(s => s.id === form.subjectId);
      const newA: MockAssessment = {
        id: Date.now().toString(),
        subject: sub?.name || 'Subject',
        quarter: form.quarter,
        type: form.type,
        items: form.items,
        createdAt: new Date().toISOString(),
      };
      setAssessments(prev => [...prev, newA]);
      setLoading(false);
      setShowGenerate(false);
      setViewId(newA.id);
    }, 2000);
  };

  const viewAssessment = viewId ? assessments.find(a => a.id === viewId) : null;
  const mockQuestions = viewAssessment ? generateMockQuestions(viewAssessment.subject, viewAssessment.type, viewAssessment.items) : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-r from-[#0F1629] to-[#1B2035] text-white px-6 py-6">
        <div className="max-w-5xl mx-auto">
          <Link href={`/classes/${id}`} className="text-white/50 text-sm hover:text-white/80 mb-2 inline-block">← Back to Class Hub</Link>
          <div className="flex items-start justify-between">
            <div>
              <span className="bg-white/10 text-white/70 text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">Smart Assessments</span>
              <h1 className="text-2xl font-bold mt-1">Assessment Generator</h1>
              <p className="text-white/50 text-sm">Generate comprehensive quizzes and TOS instantly for {cls?.name}</p>
            </div>
            <button onClick={() => setShowGenerate(true)} className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">+ Generate New Assessment</button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {viewAssessment ? (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-800">{viewAssessment.subject} — {viewAssessment.type} Q{viewAssessment.quarter}</h2>
                <p className="text-gray-500 text-sm">{viewAssessment.items} items</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowAnswers(!showAnswers)} className="border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-semibold px-4 py-2 rounded-lg text-sm">
                  {showAnswers ? 'Hide' : 'Show'} Answer Key
                </button>
                <button onClick={() => setViewId(null)} className="border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-semibold px-4 py-2 rounded-lg text-sm">← Back</button>
              </div>
            </div>
            {/* TOS Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                <h3 className="font-bold text-gray-800">Table of Specifications (TOS)</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['Topic', 'Hours', '% Weight', 'No. Items', 'REM', 'UND', 'APP', 'ANA', 'EVA', 'CRE', 'Placement'].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {['Chapter 1: Foundations', 'Chapter 2: Core Concepts', 'Chapter 3: Applications', 'Chapter 4: Advanced Topics'].map((topic, i) => (
                      <tr key={i} className="border-b border-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-800">{topic}</td>
                        <td className="px-3 py-2 text-gray-600">{4 + i}</td>
                        <td className="px-3 py-2 text-gray-600">{[30, 25, 25, 20][i]}%</td>
                        <td className="px-3 py-2 font-bold text-gray-800">{Math.round(viewAssessment.items * [0.3, 0.25, 0.25, 0.2][i])}</td>
                        <td className="px-3 py-2 text-gray-500">{2+i}</td>
                        <td className="px-3 py-2 text-gray-500">{2+i}</td>
                        <td className="px-3 py-2 text-gray-500">{1+i}</td>
                        <td className="px-3 py-2 text-gray-500">{i}</td>
                        <td className="px-3 py-2 text-gray-500">{i}</td>
                        <td className="px-3 py-2 text-gray-500">{i > 1 ? 1 : 0}</td>
                        <td className="px-3 py-2 text-gray-500">{i * 3 + 1}-{i * 3 + 3}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {/* Questions */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100">
              <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                <h3 className="font-bold text-gray-800">Test Questionnaire (Sample — first 10 items)</h3>
              </div>
              <div className="p-5 space-y-5">
                {mockQuestions.map(q => (
                  <div key={q.number} className="border-b border-gray-50 pb-4">
                    <p className="font-semibold text-gray-800 mb-2">{q.number}. {q.question}</p>
                    <div className="space-y-1 ml-4">
                      {q.choices.map((c, ci) => (
                        <p key={ci} className={`text-sm ${showAnswers && c === q.answer ? 'text-green-700 font-bold bg-green-50 px-2 py-0.5 rounded' : 'text-gray-600'}`}>{c}</p>
                      ))}
                    </div>
                  </div>
                ))}
                {viewAssessment.items > 10 && <p className="text-gray-400 text-sm italic text-center">... and {viewAssessment.items - 10} more items</p>}
              </div>
            </div>
          </div>
        ) : assessments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-6xl mb-4">🧩</div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">No assessments yet</h3>
            <p className="text-gray-500 mb-6">Generate your first assessment with AI-powered TOS and questionnaire.</p>
            <button onClick={() => setShowGenerate(true)} className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-6 py-2.5 rounded-xl text-sm">+ Generate New Assessment</button>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-5 py-3 font-semibold text-gray-600">Subject</th>
                  <th className="text-left px-5 py-3 font-semibold text-gray-600">Quarter</th>
                  <th className="text-left px-5 py-3 font-semibold text-gray-600">Type</th>
                  <th className="text-left px-5 py-3 font-semibold text-gray-600">Items</th>
                  <th className="text-left px-5 py-3 font-semibold text-gray-600">Date</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {assessments.map(a => (
                  <tr key={a.id} className="border-b border-gray-50">
                    <td className="px-5 py-3 font-semibold text-gray-800">{a.subject}</td>
                    <td className="px-5 py-3 text-gray-600">Q{a.quarter}</td>
                    <td className="px-5 py-3 text-gray-600">{a.type}</td>
                    <td className="px-5 py-3 text-gray-600">{a.items}</td>
                    <td className="px-5 py-3 text-gray-500">{new Date(a.createdAt).toLocaleDateString()}</td>
                    <td className="px-5 py-3"><button onClick={() => setViewId(a.id)} className="text-purple-600 hover:underline font-semibold text-sm">View →</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={showGenerate} onClose={() => setShowGenerate(false)} title="Generate Assessment" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Subject</label>
            <select value={form.subjectId} onChange={e => setForm(f => ({ ...f, subjectId: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
              <option value="">Select subject...</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Quarter</label>
              <select value={form.quarter} onChange={e => setForm(f => ({ ...f, quarter: Number(e.target.value) }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                {[1,2,3,4].map(q => <option key={q} value={q}>Q{q}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Number of Items</label>
              <input type="number" min={5} max={100} value={form.items} onChange={e => setForm(f => ({ ...f, items: Number(e.target.value) }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Assessment Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
              <option>Quarterly Exam</option>
              <option>Long Test</option>
              <option>Quiz</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => setShowGenerate(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleGenerate} disabled={!form.subjectId || loading}>
              {loading ? '⏳ Generating...' : '✨ Generate'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
