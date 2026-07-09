'use client';
import { useState, useCallback } from 'react';
import { computeTermGrade } from '@/lib/gradeCalc';
import { ComponentWeights } from '@/lib/gradingPolicy';
import { GradingResult } from '@/types';
import GradeBreakdownCard from './GradeBreakdownCard';

interface RawScores {
  wwRaw: number;
  wwHighest: number;
  ptRaw: number;
  ptHighest: number;
  stTeRaw: number;
  stTeHighest: number;
}

interface Props {
  studentName: string;
  term: number;
  weights: ComponentWeights;
  subjectGroup: string;
  initialScores?: Partial<RawScores>;
  onSave?: (scores: RawScores, result: GradingResult) => void;
  readOnly?: boolean;
}

const DEFAULT_SCORES: RawScores = {
  wwRaw: 0, wwHighest: 0,
  ptRaw: 0, ptHighest: 0,
  stTeRaw: 0, stTeHighest: 0,
};

export default function TermGradeInput({
  studentName,
  term,
  weights,
  subjectGroup,
  initialScores,
  onSave,
  readOnly = false,
}: Props) {
  const [scores, setScores] = useState<RawScores>({ ...DEFAULT_SCORES, ...initialScores });
  const [saved, setSaved] = useState(false);

  const noTermExam = weights.stTe === null;

  const result: GradingResult | null =
    scores.wwHighest > 0 || scores.ptHighest > 0
      ? computeTermGrade(
          scores.wwRaw, scores.wwHighest,
          scores.ptRaw, scores.ptHighest,
          noTermExam ? 0 : scores.stTeRaw,
          noTermExam ? 0 : scores.stTeHighest,
          weights,
        )
      : null;

  const set = useCallback((field: keyof RawScores, val: string) => {
    const n = parseFloat(val) || 0;
    setScores(prev => ({ ...prev, [field]: n }));
    setSaved(false);
  }, []);

  const handleSave = () => {
    if (!result || !onSave) return;
    onSave(scores, result);
    setSaved(true);
  };

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-800">{studentName}</p>
          <p className="text-xs text-gray-400">Term {term}</p>
        </div>
        {result && (
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-gray-900">{result.transmutedGrade}</span>
            <span className="text-xs text-gray-500">{result.descriptor}</span>
          </div>
        )}
      </div>

      {/* Score inputs */}
      <div className="p-4 grid grid-cols-1 gap-4">
        <ScoreRow
          label="Written Works (WW)"
          color="blue"
          rawField="wwRaw"
          highestField="wwHighest"
          scores={scores}
          set={set}
          readOnly={readOnly}
        />
        <ScoreRow
          label="Performance Tasks (PT)"
          color="violet"
          rawField="ptRaw"
          highestField="ptHighest"
          scores={scores}
          set={set}
          readOnly={readOnly}
        />
        {!noTermExam && (
          <ScoreRow
            label="Summative Tests + Term Exam (STs-TE)"
            color="teal"
            rawField="stTeRaw"
            highestField="stTeHighest"
            scores={scores}
            set={set}
            readOnly={readOnly}
          />
        )}
      </div>

      {/* Result */}
      {result && (
        <div className="border-t border-gray-100 p-4">
          <GradeBreakdownCard
            result={result}
            subjectGroup={subjectGroup}
            hasTermExam={!noTermExam}
          />
        </div>
      )}

      {/* Save */}
      {!readOnly && onSave && (
        <div className="border-t border-gray-100 px-4 py-3 flex justify-end">
          <button
            onClick={handleSave}
            disabled={!result}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              saved
                ? 'bg-green-100 text-green-700'
                : 'bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40'
            }`}
          >
            {saved ? '✓ Saved' : 'Save Term Grade'}
          </button>
        </div>
      )}
    </div>
  );
}

const COLOR_INPUT: Record<string, string> = {
  blue: 'border-blue-200 focus:ring-blue-400',
  violet: 'border-violet-200 focus:ring-violet-400',
  teal: 'border-teal-200 focus:ring-teal-400',
};

function ScoreRow({
  label, color, rawField, highestField, scores, set, readOnly,
}: {
  label: string;
  color: string;
  rawField: keyof RawScores;
  highestField: keyof RawScores;
  scores: RawScores;
  set: (f: keyof RawScores, v: string) => void;
  readOnly: boolean;
}) {
  const ring = COLOR_INPUT[color] ?? COLOR_INPUT.blue;
  return (
    <div>
      <p className="text-xs font-medium text-gray-600 mb-2">{label}</p>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-xs text-gray-400">Learner Score</label>
          <input
            type="number"
            min={0}
            readOnly={readOnly}
            className={`w-full border rounded-lg px-3 py-2 text-sm mt-0.5 focus:outline-none focus:ring-2 ${ring} ${readOnly ? 'bg-gray-50' : ''}`}
            value={scores[rawField] || ''}
            onChange={e => set(rawField, e.target.value)}
          />
        </div>
        <span className="text-gray-400 mt-5">/</span>
        <div className="flex-1">
          <label className="text-xs text-gray-400">Highest Possible</label>
          <input
            type="number"
            min={0}
            readOnly={readOnly}
            className={`w-full border rounded-lg px-3 py-2 text-sm mt-0.5 focus:outline-none focus:ring-2 ${ring} ${readOnly ? 'bg-gray-50' : ''}`}
            value={scores[highestField] || ''}
            onChange={e => set(highestField, e.target.value)}
          />
        </div>
        {scores[highestField] > 0 && (
          <div className="mt-5 text-sm font-semibold text-gray-700 w-14 text-right">
            {((scores[rawField] / scores[highestField]) * 100).toFixed(1)}%
          </div>
        )}
      </div>
    </div>
  );
}
