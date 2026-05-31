'use client';
import { useState, useRef } from 'react';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { Student } from '@/types';

interface BulkImportModalProps {
  open: boolean;
  classId: string;
  onClose: () => void;
  onImport: (students: Omit<Student, 'id'>[], count: number) => void;
}

function parseDate(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  // Try MM/DD/YYYY
  const parts = trimmed.split(/[\/\-\.]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) return trimmed; // YYYY-...
    return `${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`;
  }
  return trimmed;
}

function downloadTemplate() {
  const csv = 'First Name,Last Name,Middle Name,LRN,Birthday,Gender\nJuan,Dela Cruz,Santos,123456789012,2010-01-15,Male\nMaria,Garcia,,987654321098,2010-03-22,Female\n';
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'student_roster_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function BulkImportModal({ open, classId, onClose, onImport }: BulkImportModalProps) {
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const processFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) return;
      const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g,''));
      const getIdx = (...names: string[]) => names.reduce((f, n) => f !== -1 ? f : header.findIndex(h => h.includes(n)), -1);
      const fIdx = getIdx('first', 'firstname');
      const lIdx = getIdx('last', 'lastname');
      const mIdx = getIdx('middle', 'middlename');
      const lrnIdx = getIdx('lrn');
      const bIdx = getIdx('birth', 'birthday');
      const gIdx = getIdx('gender', 'sex');

      const students: Omit<Student, 'id'>[] = [];
      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        const firstName = fIdx >= 0 ? row[fIdx] : '';
        const lastName = lIdx >= 0 ? row[lIdx] : '';
        if (!firstName || !lastName) continue;
        const rawGender = gIdx >= 0 ? row[gIdx] : 'Male';
        const gender: 'Male' | 'Female' = rawGender.toLowerCase().startsWith('f') ? 'Female' : 'Male';
        students.push({
          classId,
          firstName,
          lastName,
          middleName: mIdx >= 0 ? row[mIdx] || undefined : undefined,
          lrn: lrnIdx >= 0 ? row[lrnIdx] || undefined : undefined,
          birthday: parseDate(bIdx >= 0 ? row[bIdx] : ''),
          gender,
        });
      }
      onImport(students, students.length);
      onClose();
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  return (
    <Modal open={open} onClose={onClose} title="Bulk Import Roster" size="md">
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800">
          <p className="font-bold mb-2">📋 Required Columns:</p>
          <ul className="list-disc ml-4 space-y-1 text-xs">
            <li><strong>First Name, Last Name</strong> — required</li>
            <li><strong>Gender</strong> — M or Male / F or Female</li>
            <li><strong>Birthday</strong> — YYYY-MM-DD format (auto-detected)</li>
            <li>Middle Name, LRN — optional</li>
          </ul>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={downloadTemplate} className="flex-1">
            📥 Download Blank Template
          </Button>
        </div>
        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${dragging ? 'border-green-500 bg-green-50' : 'border-gray-200 hover:border-green-400 hover:bg-green-50/30'}`}
        >
          <div className="text-4xl mb-3">📂</div>
          <p className="font-semibold text-gray-700">Drop your CSV or Excel file here</p>
          <p className="text-gray-400 text-sm mt-1">or click to browse</p>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }}
          />
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
