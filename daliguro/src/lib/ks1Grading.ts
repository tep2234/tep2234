// KS1 Descriptive Grading System (Kindergarten – Grade 3)
// Uses descriptor ratings, not numerical computation

export interface KS1DescriptorOption {
  value: string;
  label: string;
  colorClass: string;
}

// Kindergarten: 3-level scale
export const KINDER_DESCRIPTORS: KS1DescriptorOption[] = [
  { value: 'C', label: 'Consistent', colorClass: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'D', label: 'Developing', colorClass: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'B', label: 'Beginning', colorClass: 'bg-amber-100 text-amber-700 border-amber-200' },
];

// Grades 1–3: 5-level scale (A–E)
export const G1_TO_G3_DESCRIPTORS: KS1DescriptorOption[] = [
  { value: 'A', label: 'Advancing', colorClass: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'B', label: 'Benchmarking', colorClass: 'bg-blue-100 text-blue-700 border-blue-200' },
  { value: 'C', label: 'Connecting', colorClass: 'bg-sky-100 text-sky-700 border-sky-200' },
  { value: 'D', label: 'Developing', colorClass: 'bg-amber-100 text-amber-700 border-amber-200' },
  { value: 'E', label: 'Emerging', colorClass: 'bg-red-100 text-red-700 border-red-200' },
];

export function getKS1Descriptors(gradLevel: string): KS1DescriptorOption[] {
  return gradLevel === 'Kindergarten' ? KINDER_DESCRIPTORS : G1_TO_G3_DESCRIPTORS;
}

export function getKS1DescriptorOption(gradLevel: string, value: string): KS1DescriptorOption | undefined {
  return getKS1Descriptors(gradLevel).find(d => d.value === value);
}

export interface KS1Rating {
  id: string;
  studentId: string;
  subjectId: string;
  term: number;        // 1, 2, or 3
  competency: string;
  descriptor: string;  // 'A'–'E' or 'C'/'D'/'B'
  teacherRemarks?: string;
  createdAt: string;
}

// Sample competency areas — teacher can customise
export const DEFAULT_COMPETENCY_AREAS: Record<string, string[]> = {
  Kindergarten: [
    'Oral Language',
    'Phonological Awareness',
    'Book and Print Knowledge',
    'Alphabet Knowledge',
    'Writing and Drawing',
    'Number Sense',
    'Geometry',
    'Social Skills',
  ],
  'Grade 1': ['Reading', 'Writing', 'Mathematics', 'Science', 'Social Studies', 'Values'],
  'Grade 2': ['Reading', 'Writing', 'Mathematics', 'Science', 'Social Studies', 'Values'],
  'Grade 3': ['Reading', 'Writing', 'Mathematics', 'Science', 'Social Studies', 'Values'],
};
