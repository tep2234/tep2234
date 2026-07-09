'use client';
import { useMemo } from 'react';
import {
  KeyStage,
  GRADE_TO_KS,
  SUBJECT_GROUPS_BY_KS,
  getWeights,
  getKeyStage,
  getDefaultSubjectGroup,
  hasTermExam,
  ComponentWeights,
} from '@/lib/gradingPolicy';

interface Props {
  // Current class grade level (e.g. "Grade 7")
  gradLevel: string;
  // Controlled values
  keyStage: KeyStage | '';
  subjectGroup: string;
  useThreeTerms: boolean;
  // Callbacks
  onKeyStageChange: (ks: KeyStage) => void;
  onSubjectGroupChange: (group: string) => void;
  onUseThreeTermsChange: (val: boolean) => void;
  // Show resolved weights (read-only preview)
  showWeights?: boolean;
}

const KS_LABELS: Record<KeyStage, string> = {
  KS1: 'Key Stage 1 — Kinder to Grade 3 (Descriptive)',
  KS2: 'Key Stage 2 — Grades 4–6',
  KS3: 'Key Stage 3 — Grades 7–10 (Junior High)',
  KS4: 'Key Stage 4 — Grades 11–12 (Senior High)',
};

export default function SubjectGroupSelector({
  gradLevel,
  keyStage,
  subjectGroup,
  useThreeTerms,
  onKeyStageChange,
  onSubjectGroupChange,
  onUseThreeTermsChange,
  showWeights = true,
}: Props) {
  // Infer KS from grade level if not yet set
  const inferredKS = useMemo(() => getKeyStage(gradLevel), [gradLevel]);
  const activeKS: KeyStage = (keyStage as KeyStage) || inferredKS;

  const groups = SUBJECT_GROUPS_BY_KS[activeKS] ?? [];
  const isKS1 = activeKS === 'KS1';

  // Compute active weights for preview
  const weights: ComponentWeights | null = !isKS1 && subjectGroup
    ? getWeights(activeKS, subjectGroup)
    : null;

  const noTermExam = weights ? weights.stTe === null : false;

  return (
    <div className="space-y-4">
      {/* Key Stage */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Key Stage
        </label>
        <select
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          value={activeKS}
          onChange={e => {
            const ks = e.target.value as KeyStage;
            onKeyStageChange(ks);
            onSubjectGroupChange(getDefaultSubjectGroup(ks));
          }}
        >
          {(Object.keys(KS_LABELS) as KeyStage[]).map(ks => (
            <option key={ks} value={ks}>{KS_LABELS[ks]}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-400">
          Auto-detected from grade level: <strong>{inferredKS}</strong>
        </p>
      </div>

      {/* Subject Group (hidden for KS1) */}
      {!isKS1 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Subject Group
          </label>
          <select
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            value={subjectGroup}
            onChange={e => onSubjectGroupChange(e.target.value)}
          >
            <option value="">Select subject group…</option>
            {groups.map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
      )}

      {/* Three-term toggle */}
      <div className="flex items-center gap-3 p-3 bg-violet-50 rounded-lg border border-violet-100">
        <input
          id="three-terms"
          type="checkbox"
          className="h-4 w-4 accent-violet-600"
          checked={useThreeTerms}
          onChange={e => onUseThreeTermsChange(e.target.checked)}
        />
        <label htmlFor="three-terms" className="text-sm text-gray-700 cursor-pointer select-none">
          Use three-term calendar{' '}
          <span className="text-violet-600 font-medium">(SY 2026-2027)</span>
          <span className="block text-xs text-gray-400">
            Terms 1–3 instead of Quarters 1–4
          </span>
        </label>
      </div>

      {/* Weight preview */}
      {showWeights && !isKS1 && weights && subjectGroup && (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Auto-loaded component weights
            </p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-gray-100">
            <WeightCell
              label="Written Works"
              abbr="WW"
              value={weights.ww}
              color="text-blue-600"
            />
            <WeightCell
              label="Performance Tasks"
              abbr="PT"
              value={weights.pt}
              color="text-violet-600"
            />
            <WeightCell
              label={noTermExam ? 'No Term Exam' : 'STs + Term Exam'}
              abbr="STs-TE"
              value={noTermExam ? null : (weights.stTe ?? 0)}
              color="text-teal-600"
            />
          </div>
          {noTermExam && (
            <div className="px-4 py-2 bg-amber-50 border-t border-amber-100">
              <p className="text-xs text-amber-700">
                No Summative Tests / Term Exam for this subject group.
                Grade is computed from WW and PT only.
              </p>
            </div>
          )}
        </div>
      )}

      {/* KS1 info banner */}
      {isKS1 && (
        <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3">
          <p className="text-sm font-medium text-blue-700 mb-1">
            Descriptive Grading — Key Stage 1
          </p>
          <p className="text-xs text-blue-600">
            {gradLevel === 'Kindergarten'
              ? 'Kindergarten uses a 3-level scale: Consistent (C), Developing (D), Beginning (B).'
              : 'Grades 1–3 use a 5-level scale: Advancing (A), Benchmarking (B), Connecting (C), Developing (D), Emerging (E).'}
          </p>
          <p className="text-xs text-blue-500 mt-1">
            Numerical computation is not used for KS1.
          </p>
        </div>
      )}
    </div>
  );
}

function WeightCell({
  label,
  abbr,
  value,
  color,
}: {
  label: string;
  abbr: string;
  value: number | null;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center py-3 px-2">
      <span className={`text-2xl font-bold ${value === null ? 'text-gray-300' : color}`}>
        {value === null ? '—' : `${value}%`}
      </span>
      <span className={`text-xs font-semibold mt-0.5 ${color}`}>{abbr}</span>
      <span className="text-xs text-gray-400 text-center leading-tight mt-1">{label}</span>
    </div>
  );
}
