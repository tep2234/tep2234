'use client';
import { GradingResult } from '@/types';
import { getDescriptorColor } from '@/lib/gradingPolicy';

interface Props {
  result: GradingResult;
  subjectGroup: string;
  hasTermExam: boolean;
  compact?: boolean;
}

export default function GradeBreakdownCard({ result, subjectGroup, hasTermExam, compact }: Props) {
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span className={`text-lg font-bold ${result.transmutedGrade >= 75 ? 'text-gray-900' : 'text-red-600'}`}>
          {result.transmutedGrade}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${getDescriptorColor(result.transmutedGrade)}`}>
          {result.descriptor}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden text-sm">
      {/* Header */}
      <div className="bg-gray-800 text-white px-4 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide opacity-70">
          Grade Breakdown — {subjectGroup}
        </span>
        <span className="text-xs opacity-50">SY 2026-2027</span>
      </div>

      {/* Step 1–3: Components */}
      <div className="grid grid-cols-3 divide-x divide-gray-100">
        <ComponentCol
          label="Written Works"
          abbr="WW"
          ps={result.wwPS}
          ws={result.wwWS}
          color="blue"
        />
        <ComponentCol
          label="Performance Tasks"
          abbr="PT"
          ps={result.ptPS}
          ws={result.ptWS}
          color="violet"
        />
        {hasTermExam ? (
          <ComponentCol
            label="STs + Term Exam"
            abbr="STs-TE"
            ps={result.stTePS}
            ws={result.stTeWS}
            color="teal"
          />
        ) : (
          <div className="flex items-center justify-center p-4 bg-gray-50">
            <span className="text-xs text-gray-400 text-center">No Term Exam<br/>for this group</span>
          </div>
        )}
      </div>

      {/* Step 4–5: Initial → Transmuted */}
      <div className="border-t border-gray-100 grid grid-cols-2 divide-x divide-gray-100">
        <div className="p-4">
          <p className="text-xs text-gray-400 mb-1">Initial Grade</p>
          <p className="text-2xl font-bold text-gray-700">{result.initialGrade.toFixed(2)}</p>
          <p className="text-xs text-gray-400 mt-1">WW + PT + STs-TE weighted scores</p>
        </div>
        <div className="p-4 bg-gray-50">
          <p className="text-xs text-gray-400 mb-1">Transmuted Term Grade</p>
          <p className={`text-3xl font-bold ${result.transmutedGrade >= 75 ? 'text-gray-900' : 'text-red-600'}`}>
            {result.transmutedGrade}
          </p>
        </div>
      </div>

      {/* Descriptor row */}
      <div className={`px-4 py-3 border-t border-gray-100 flex items-center justify-between ${
        result.transmutedGrade >= 75 ? 'bg-gray-50' : 'bg-red-50'
      }`}>
        <div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full border text-sm font-semibold ${getDescriptorColor(result.transmutedGrade)}`}>
            {result.descriptor}
          </span>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">Recommended Action</p>
          <p className="text-xs font-medium text-gray-600">{result.intervention}</p>
        </div>
      </div>
    </div>
  );
}

const COLOR_MAP: Record<string, { bg: string; text: string; border: string }> = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-600', border: 'border-violet-200' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-600', border: 'border-teal-200' },
};

function ComponentCol({
  label,
  abbr,
  ps,
  ws,
  color,
}: {
  label: string;
  abbr: string;
  ps: number;
  ws: number;
  color: string;
}) {
  const c = COLOR_MAP[color] ?? COLOR_MAP.blue;
  return (
    <div className={`p-4 ${c.bg}`}>
      <p className={`text-xs font-semibold ${c.text} mb-2`}>{abbr} — {label}</p>
      <div className="space-y-1">
        <div>
          <p className="text-xs text-gray-400">% Score (PS)</p>
          <p className="text-lg font-bold text-gray-800">{ps.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">Weighted Score (WS)</p>
          <p className={`text-sm font-semibold ${c.text}`}>{ws.toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
}
