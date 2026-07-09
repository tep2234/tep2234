'use client';
import { useState } from 'react';
import { useClasses } from '@/hooks/useClasses';
import { useStudents } from '@/hooks/useStudents';
import ClassCard from '@/components/classes/ClassCard';
import CreateClassModal from '@/components/classes/CreateClassModal';
import Toast from '@/components/ui/Toast';
import { Class } from '@/types';

export default function DashboardPage() {
  const { classes, loaded, addClass, toggleStar, deleteClass } = useClasses();
  const { allStudents } = useStudents();
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const countStudents = (classId: string) =>
    allStudents.filter(s => s.classId === classId).length;

  const handleCreate = (data: Omit<Class, 'id' | 'createdAt'>) => {
    addClass(data);
    setToast('Class created successfully!');
  };

  const handleDelete = (id: string) => {
    if (confirm('Delete this class? This cannot be undone.')) {
      deleteClass(id);
      setToast('Class deleted.');
    }
  };

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-r from-[#0F1629] to-[#1B2035] text-white px-6 py-6 shadow-lg">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-2xl font-black tracking-tight text-purple-300">Daliguro</span>
              <span className="bg-purple-500/20 text-purple-300 text-xs font-bold px-2 py-0.5 rounded-full">TEACHER PORTAL</span>
            </div>
            <p className="text-white/50 text-sm">School Management System</p>
          </div>
          {classes.length > 0 && (
            <button
              onClick={() => setShowCreate(true)}
              className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-5 py-2.5 rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              <span className="text-lg leading-none">+</span> Add Class
            </button>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {classes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-28 text-center">
            <div className="text-7xl mb-6">🗂️</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Your dashboard is empty</h2>
            <p className="text-gray-500 mb-8 max-w-sm">
              Start by creating your first class. You can manage students, attendance, grades, and more.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="bg-gray-900 hover:bg-gray-800 text-white font-semibold px-8 py-3.5 rounded-xl text-base transition-colors"
            >
              + Create First Class
            </button>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-lg font-bold text-gray-800">My Classes</h2>
              <p className="text-gray-500 text-sm">{classes.length} class{classes.length !== 1 ? 'es' : ''} total</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {classes.map(cls => (
                <ClassCard
                  key={cls.id}
                  cls={cls}
                  studentCount={countStudents(cls.id)}
                  onToggleStar={toggleStar}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <CreateClassModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSave={handleCreate}
      />

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
