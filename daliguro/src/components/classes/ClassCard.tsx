'use client';
import Link from 'next/link';
import { Class } from '@/types';

interface ClassCardProps {
  cls: Class;
  studentCount: number;
  onToggleStar: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function ClassCard({ cls, studentCount, onToggleStar, onDelete }: ClassCardProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow group">
      {/* Top gradient */}
      <div className="bg-gradient-to-r from-purple-600 to-indigo-500 px-5 pt-4 pb-8 relative">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {cls.gradLevel}
            </span>
            <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {cls.schoolYear}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={e => { e.preventDefault(); onToggleStar(cls.id); }}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
              title="Star class"
            >
              {cls.starred ? '★' : '☆'}
            </button>
            <button
              onClick={e => { e.preventDefault(); onDelete(cls.id); }}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-red-400/30 transition-colors text-white/70 hover:text-white"
              title="Delete class"
            >
              🗑
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <Link href={`/classes/${cls.id}`} className="block">
        <div className="px-5 -mt-5 pb-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-3">
            <p className="text-xl font-bold text-purple-700 mb-0.5">{cls.name}</p>
            <p className="text-sm text-gray-500">{cls.program}</p>
          </div>
          {/* Bottom strip */}
          <div className="flex items-center justify-between text-sm text-gray-500">
            <div className="flex items-center gap-2">
              <span className="text-lg">👥</span>
              <span className="font-medium text-gray-700">{studentCount} Students</span>
            </div>
            <span className="text-purple-500 font-semibold group-hover:translate-x-1 transition-transform">→</span>
          </div>
        </div>
      </Link>
    </div>
  );
}
