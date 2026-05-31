'use client';
import { useState } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Student } from '@/types';

interface AddStudentModalProps {
  open: boolean;
  classId: string;
  onClose: () => void;
  onSave: (data: Omit<Student, 'id'>) => void;
}

export default function AddStudentModal({ open, classId, onClose, onSave }: AddStudentModalProps) {
  const [form, setForm] = useState({
    firstName: '', lastName: '', middleName: '', lrn: '',
    birthday: '', gender: 'Male' as 'Male' | 'Female',
    guardian: '', contact: '', email: '',
  });

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.birthday) return;
    onSave({
      classId,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      middleName: form.middleName.trim() || undefined,
      lrn: form.lrn.trim() || undefined,
      birthday: form.birthday,
      gender: form.gender,
      guardian: form.guardian.trim() || undefined,
      contact: form.contact.trim() || undefined,
      email: form.email.trim() || undefined,
    });
    setForm({ firstName: '', lastName: '', middleName: '', lrn: '', birthday: '', gender: 'Male', guardian: '', contact: '', email: '' });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Student" size="md">
      <div className="space-y-4">
        <div className="bg-green-50 border border-green-100 rounded-lg p-3 text-xs text-green-700">
          💡 <strong>Time-saving tip:</strong> Have many students? Use <button className="underline font-semibold" onClick={onClose}>Bulk Import</button> to add them all at once.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">First Name <span className="text-red-500">*</span></label>
            <input value={form.firstName} onChange={e => set('firstName', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Last Name <span className="text-red-500">*</span></label>
            <input value={form.lastName} onChange={e => set('lastName', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Middle Name</label>
            <input value={form.middleName} onChange={e => set('middleName', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">LRN (12-digit, optional)</label>
            <input value={form.lrn} onChange={e => set('lrn', e.target.value)} maxLength={12}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Birthday <span className="text-red-500">*</span></label>
            <input type="date" value={form.birthday} onChange={e => set('birthday', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Gender <span className="text-red-500">*</span></label>
            <select value={form.gender} onChange={e => set('gender', e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
              <option>Male</option>
              <option>Female</option>
            </select>
          </div>
        </div>
        <div className="border-t border-gray-100 pt-3">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Contact Information (Optional)</p>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Guardian Name</label>
              <input value={form.guardian} onChange={e => set('guardian', e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Contact Number</label>
                <input value={form.contact} onChange={e => set('contact', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Email</label>
                <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={!form.firstName.trim() || !form.lastName.trim() || !form.birthday}>
            Add Student
          </Button>
        </div>
      </div>
    </Modal>
  );
}
