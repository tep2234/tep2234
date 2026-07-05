// Demo / sample data for local testing only.
// Produces a complete, internally consistent assessment so a teacher can try
// the whole flow without typing. SECURITY: the answer key lives in
// state.answerKeys (never in any QR) — identical to real data.

import type {
  Assessment,
  AssessmentKeys,
  Item,
  Learner,
  QrAssessmentState,
  TestVersion,
  VersionKey,
} from "./types";

export interface DemoBundle {
  assessment: Assessment;
  items: Item[];
  learners: Learner[];
  answerKeys: AssessmentKeys;
}

// 10 A–D answers per version, so the whole demo is OMR-readable (scores /10).
const MC_KEY_A = ["B", "C", "A", "D", "B", "A", "C", "B", "D", "A"];
const MC_KEY_B = ["C", "B", "D", "A", "C", "D", "A", "B", "B", "C"];

function buildItems(assessmentId: string): Item[] {
  const items: Item[] = [];
  // 10 multiple-choice (A–D) objective items — all OMR-readable.
  for (let i = 0; i < 10; i += 1) {
    items.push({
      id: "I_demo" + String(i + 1).padStart(2, "0"),
      assessmentId,
      itemNumber: i + 1,
      type: "Multiple Choice",
      question: "Sample multiple-choice question " + (i + 1),
      correctAnswer: "",
      acceptedAnswers: [],
      points: 1,
      competency: i < 5 ? "Identifies rational equations" : "Solves rational equations",
      topic: i < 5 ? "Rational Equations — Basics" : "Rational Equations — Application",
      difficulty: i % 3 === 0 ? "Easy" : i % 3 === 1 ? "Average" : "Difficult",
      cognitiveLevel: i < 5 ? "Remembering" : "Applying",
      choices: 4,
    });
  }
  return items;
}

function buildVersionKey(objectiveItems: Item[], letters: string[]): VersionKey {
  const key: VersionKey = {};
  objectiveItems.forEach((item, i) => {
    key[item.id] = letters[i] ?? "A";
  });
  return key;
}

const DEMO_NAMES: [string, "M" | "F"][] = [
  ["Dela Cruz, Juan", "M"],
  ["Santos, Maria", "F"],
  ["Reyes, Pedro", "M"],
  ["Garcia, Ana", "F"],
  ["Bautista, Jose", "M"],
];

// Fixed so "Load demo" produces the SAME assessment on every device — a sheet
// printed from one device's demo then validates when scanned on another.
export const DEMO_ASSESSMENT_ID = "A_demo";

export function buildDemoBundle(): DemoBundle {
  const now = Date.now();
  const assessmentId = DEMO_ASSESSMENT_ID;
  const versions: TestVersion[] = ["A", "B"];

  const assessment: Assessment = {
    id: assessmentId,
    title: "Demo Quiz — General Mathematics",
    subject: "General Mathematics",
    gradeLevel: "11",
    section: "STEM-A",
    schoolYear: "2026-2027",
    term: "First",
    component: "Written Work",
    versions,
    teacherName: "Demo Teacher",
    createdAt: now,
    updatedAt: now,
  };

  const items = buildItems(assessmentId);
  const objective = items.filter((i) => i.type === "Multiple Choice");

  const answerKeys: AssessmentKeys = {
    A: buildVersionKey(objective, MC_KEY_A),
    B: buildVersionKey(objective, MC_KEY_B),
  };

  const learners: Learner[] = DEMO_NAMES.map(([fullName, sex], i) => ({
    id: "L_demo" + (i + 1),
    lrn: "13600000000" + (i + 1),
    fullName,
    sex,
    gradeLevel: "11",
    section: "STEM-A",
  }));

  return { assessment, items, learners, answerKeys };
}

// Merge a demo bundle into existing state. Idempotent: loading the demo twice
// (or on a second device with the same fixed IDs) does not duplicate it.
export function withDemoBundle(
  state: QrAssessmentState,
  bundle: DemoBundle,
): QrAssessmentState {
  const id = bundle.assessment.id;
  // Replace any existing demo assessment + its items/keys so a re-load refreshes
  // (handles upgrading from an older random-ID demo too, by id match only).
  const assessments = state.assessments.some((a) => a.id === id)
    ? state.assessments.map((a) => (a.id === id ? bundle.assessment : a))
    : state.assessments.concat(bundle.assessment);
  const items = state.items
    .filter((i) => i.assessmentId !== id)
    .concat(bundle.items);
  // Demo learners are authoritative: drop any existing learner that collides by
  // id OR LRN (e.g. a stale random-ID demo learner) so every device ends up with
  // the SAME fixed demo learner IDs — otherwise printed QRs won't validate.
  const demoIds = new Set(bundle.learners.map((l) => l.id));
  const demoLrns = new Set(bundle.learners.map((l) => l.lrn));
  const learners = state.learners
    .filter((l) => !demoIds.has(l.id) && !(l.lrn && demoLrns.has(l.lrn)))
    .concat(bundle.learners);
  return {
    ...state,
    assessments,
    items,
    learners,
    answerKeys: { ...state.answerKeys, [id]: bundle.answerKeys },
  };
}
