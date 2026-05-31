'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useClasses } from '@/hooks/useClasses';
import { useStudents } from '@/hooks/useStudents';
import { useSubjects } from '@/hooks/useSubjects';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import Toast from '@/components/ui/Toast';
import { Subject } from '@/types';

interface Props { params: Promise<{ id: string }> }

const SUBJECT_COLORS = ['bg-teal-500', 'bg-purple-500', 'bg-blue-500', 'bg-orange-500', 'bg-red-500', 'bg-green-500'];

export default function GradingPage({ params }: Props) {
  const { id } = use(params);
  const { getClass } = useClasses();
  const { students } = useStudents(id);
  const { subjects, addSubject, deleteSubject } = useSubjects(id);
  const cls = getClass(id);
  const [showAdd, setShowAdd] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', code: '', wwWeight: 30, ptWeight: 50, qaWeight: 20 });

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }));
  const total = form.wwWeight + form.ptWeight + form.qaWeight;

  const handleSave = () => {
    if (!form.name.trim() || !form.code.trim() || total !== 100) return;
    addSubject({ classId: id, ...form });
    setForm({ name: '', code: '', wwWeight: 30, ptWeight: 50, qaWeight: 20 });
    setShowAdd(false);
    setToast('Subject added!');
  };

  const handleDelete = (sub: Subject) => {
    if (confirm(`Delete ${sub.name}?`)) { deleteSubject(sub.id); setToast('Subject deleted.'); }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-r from-[#0F1629] to-[#1B2035] text-white px-6 py-6">
        <div className="max-w-5xl mx-auto">
          <Link href={`/classes/${id}`} className="text-white/50 text-sm hover:text-white/80 mb-2 inline-block">← Back to Class Hub</Link>
          <div className="flex items-start justify-between">
            <div>
              <span className="bg-white/10 text-white/70 text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">Academic Standards</span>
              <h1 className="text-2xl font-bold mt-1">Subject Gradebooks</h1>
              <p className="text-white/50 text-sm">Manage weights and entry points for {subjects.length} subjects in {cls?.name}</p>
            </div>
            <button onClick={() => setShowAdd(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">+ Add Subject</button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {subjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-6xl mb-4">📚</div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">No subjects yet</h3>
            <p className="text-gray-500 mb-6">Add your first subject to start managing grades.</p>
            <button onClick={() => setShowAdd(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-6 py-2.5 rounded-xl text-sm">+ Add Subject</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {subjects.map((sub, i) => (
              <div key={sub.id} className="bg-white rounded-xl shadow-sm border-t-4 border-teal-500 p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-10 h-10 ${SUBJECT_COLORS[i % SUBJECT_COLORS.length]} rounded-xl flex items-center justify-center text-white font-bold text-sm`}>
                    {sub.code.slice(0, 2).toUpperCase()}
                  </div>
                  <button onClick={() => handleDelete(sub)} className="text-gray-300 hover:text-red-400 transition-colors" title="Delete subject">🗑</button>
                </div>
                <h3 className="font-bold text-gray-900 mb-1">{sub.name}</h3>
                <div className="flex gap-2 text-xs mb-4">
                  <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">WW {sub.wwWeight}%</span>
                  <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">PT {sub.ptWeight}%</span>
                  <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">QA {sub.qaWeight}%</span>
                </div>
                <Link href={`/classes/${id}/grading/${sub.id}`}
                  className="block w-full text-center bg-gray-900 hover:bg-gray-800 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
                  Open Gradebook →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Subject Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Subject" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Subject Name <span className="text-red-500">*</span></label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Mathematics"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Subject Code <span className="text-red-500">*</span></label>
            <input value={form.code} onChange={e => set('code', e.target.value)} placeholder="e.g. MATH10"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>
          <div className="border-t border-gray-100 pt-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Grading Weights (must sum to 100)</p>
            <div className="grid grid-cols-3 gap-3">
              {[['Written Works', 'wwWeight'], ['Performance Tasks', 'ptWeight'], ['Quarterly Assessment', 'qaWeight']].map(([label, key]) => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 mb-1">{label}</label>
                  <input type="number" min={0} max={100} value={form[key as keyof typeof form] as number}
                    onChange={e => set(key, Number(e.target.value))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-teal-400" />
                </div>
              ))}
            </div>
            {total !== 100 && <p className="text-red-500 text-xs mt-2">Total must be 100. Currently: {total}</p>}
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button variant="teal" onClick={handleSave} disabled={!form.name.trim() || !form.code.trim() || total !== 100}>Save Subject</Button>
          </div>
        </div>
      </Modal>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
