'use client';
import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Class } from '@/types';

interface CreateClassModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: Omit<Class, 'id' | 'createdAt'>) => void;
}

const GRADE_LEVELS = [
  'Kindergarten',
  ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`),
  'College',
];

const currentYear = new Date().getFullYear();
const DEFAULT_SCHOOL_YEAR = `${currentYear}-${currentYear + 1}`;

export default function CreateClassModal({ open, onClose, onSave }: CreateClassModalProps) {
  const [form, setForm] = useState({
    gradLevel: 'Grade 7',
    program: '',
    name: '',
    schoolYear: DEFAULT_SCHOOL_YEAR,
    gradingPeriods: 4,
  });

  const set = (key: string, val: string | number) => setForm(f => ({ ...f, [key]: val }));

  const handleSave = () => {
    if (!form.name.trim()) return;
    onSave(form);
    setForm({ gradLevel: 'Grade 7', program: '', name: '', schoolYear: DEFAULT_SCHOOL_YEAR, gradingPeriods: 4 });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Create New Class" size="md">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Grade Level</label>
          <select
            value={form.gradLevel}
            onChange={e => set('gradLevel', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            {GRADE_LEVELS.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Program / Course / Strand</label>
          <input
            type="text"
            placeholder="e.g. STEM, ABM, General"
            value={form.program}
            onChange={e => set('program', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Section Name <span className="text-red-500">*</span></label>
          <input
            type="text"
            placeholder="e.g. Rizal, Einstein, or Section A"
            value={form.name}
            onChange={e => set('name', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">School Year</label>
          <input
            type="text"
            value={form.schoolYear}
            onChange={e => set('schoolYear', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Number of Grading Periods</label>
          <input
            type="number"
            min={1}
            max={4}
            value={form.gradingPeriods}
            onChange={e => set('gradingPeriods', Number(e.target.value))}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={!form.name.trim()}>
            Save Class
          </Button>
        </div>
      </div>
    </Modal>
  );
}
