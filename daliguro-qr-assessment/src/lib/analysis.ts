// Phase 10 — analysis computations. Pure functions, read-only over results.

import type {
  Assessment,
  Item,
  ItemScore,
  Learner,
  MasteryStatus,
  Result,
} from "./types";
import { masteryBand } from "./scoring";

const UNTAGGED = "Untagged Competency";

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function competencyOf(item: Item): string {
  return item.competency.trim() === "" ? UNTAGGED : item.competency.trim();
}

// Was a single item score a "correct" outcome?
function isScoreCorrect(score: ItemScore): boolean {
  if (score.blank) return false;
  if (score.manual) return score.awarded >= score.points && score.points > 0;
  return score.correct;
}

// ---- Item analysis -----------------------------------------

export type DifficultyLabel = "Easy" | "Moderate" | "Difficult" | "Very Difficult";

// SmartScan difficulty cutoffs: 80/60/40 percent correct.
export function difficultyLabel(percentCorrect: number): DifficultyLabel {
  if (percentCorrect >= 80) return "Easy";
  if (percentCorrect >= 60) return "Moderate";
  if (percentCorrect >= 40) return "Difficult";
  return "Very Difficult";
}

export interface ItemAnalysisRow {
  item: Item;
  competency: string;
  attempts: number;
  correct: number;
  incorrect: number;
  blank: number;
  percentCorrect: number;
  difficulty: DifficultyLabel;
}

export function analyzeItems(items: Item[], results: Result[]): ItemAnalysisRow[] {
  // Index every item score by itemId across all results.
  const scoresByItem = new Map<string, ItemScore[]>();
  results.forEach((r) => {
    r.itemScores.forEach((s) => {
      const list = scoresByItem.get(s.itemId) ?? [];
      list.push(s);
      scoresByItem.set(s.itemId, list);
    });
  });

  return items
    .slice()
    .sort((a, b) => a.itemNumber - b.itemNumber)
    .map((item) => {
      const scores = scoresByItem.get(item.id) ?? [];
      let correct = 0;
      let blank = 0;
      scores.forEach((s) => {
        if (s.blank) blank += 1;
        else if (isScoreCorrect(s)) correct += 1;
      });
      const attempts = scores.length;
      const incorrect = attempts - correct - blank;
      const percentCorrect = attempts > 0 ? round1((correct / attempts) * 100) : 0;
      return {
        item,
        competency: competencyOf(item),
        attempts,
        correct,
        incorrect,
        blank,
        percentCorrect,
        difficulty: difficultyLabel(percentCorrect),
      };
    });
}

export function mostMissed(rows: ItemAnalysisRow[], n: number): ItemAnalysisRow[] {
  return rows
    .slice()
    .sort((a, b) => a.percentCorrect - b.percentCorrect)
    .slice(0, n);
}

export function leastMissed(rows: ItemAnalysisRow[], n: number): ItemAnalysisRow[] {
  return rows
    .slice()
    .sort((a, b) => b.percentCorrect - a.percentCorrect)
    .slice(0, n);
}

export function blankHeavy(rows: ItemAnalysisRow[], n: number): ItemAnalysisRow[] {
  return rows
    .slice()
    .filter((r) => r.blank > 0)
    .sort((a, b) => b.blank - a.blank)
    .slice(0, n);
}

// ---- Common wrong answers ----------------------------------

export interface WrongAnswerTally {
  response: string;
  count: number;
}

// For each item, tally non-blank wrong responses (excludes manual items).
export function commonWrongAnswers(
  items: Item[],
  results: Result[],
): Map<string, WrongAnswerTally[]> {
  const out = new Map<string, WrongAnswerTally[]>();

  items.forEach((item) => {
    const tally = new Map<string, number>();
    results.forEach((r) => {
      const score = r.itemScores.find((s) => s.itemId === item.id);
      if (!score || score.manual || score.blank || isScoreCorrect(score)) return;
      const answer = r.answers.find((a) => a.itemId === item.id);
      const text = answer ? answer.response.trim() : "";
      if (text === "") return;
      tally.set(text, (tally.get(text) ?? 0) + 1);
    });
    const list = Array.from(tally.entries())
      .map(([response, count]) => ({ response, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    if (list.length > 0) out.set(item.id, list);
  });

  return out;
}

// ---- Competency mastery ------------------------------------

export interface CompetencyRow {
  competency: string;
  learnersChecked: number;
  possiblePoints: number;
  earnedPoints: number;
  masteryPercent: number;
  masteryLabel: MasteryStatus;
  needsReteaching: boolean;
}

export function competencyMastery(
  items: Item[],
  results: Result[],
): CompetencyRow[] {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const groups = new Map<string, { possible: number; earned: number }>();

  results.forEach((r) => {
    r.itemScores.forEach((s) => {
      const item = itemsById.get(s.itemId);
      if (!item) return;
      const comp = competencyOf(item);
      const g = groups.get(comp) ?? { possible: 0, earned: 0 };
      g.possible += s.points;
      g.earned += s.awarded;
      groups.set(comp, g);
    });
  });

  return Array.from(groups.entries())
    .map(([competency, g]) => {
      const pct = g.possible > 0 ? round1((g.earned / g.possible) * 100) : 0;
      return {
        competency,
        learnersChecked: results.length,
        possiblePoints: g.possible,
        earnedPoints: g.earned,
        masteryPercent: pct,
        masteryLabel: masteryBand(pct),
        needsReteaching: pct < 75,
      };
    })
    .sort((a, b) => a.masteryPercent - b.masteryPercent);
}

// ---- Remediation groups ------------------------------------

const ACTIONS: Record<MasteryStatus, string> = {
  Mastered: "Enrichment challenge or peer-tutoring role",
  "Near Mastery": "Short review and targeted practice",
  "Needs Reinforcement": "Guided practice with worked examples",
  "Critical Support": "Focused reteaching and individual support",
};

export interface RemediationLearner {
  name: string;
  percentage: number;
  weakCompetencies: string[];
  action: string;
}

export interface RemediationGroup {
  status: MasteryStatus;
  action: string;
  learners: RemediationLearner[];
}

// Competencies where this learner scored below 75%.
function weakCompetenciesFor(result: Result, itemsById: Map<string, Item>): string[] {
  const groups = new Map<string, { possible: number; earned: number }>();
  result.itemScores.forEach((s) => {
    const item = itemsById.get(s.itemId);
    if (!item) return;
    const comp = competencyOf(item);
    const g = groups.get(comp) ?? { possible: 0, earned: 0 };
    g.possible += s.points;
    g.earned += s.awarded;
    groups.set(comp, g);
  });
  const weak: string[] = [];
  groups.forEach((g, comp) => {
    const pct = g.possible > 0 ? (g.earned / g.possible) * 100 : 0;
    if (pct < 75) weak.push(comp);
  });
  return weak;
}

const GROUP_ORDER: MasteryStatus[] = [
  "Mastered",
  "Near Mastery",
  "Needs Reinforcement",
  "Critical Support",
];

export function remediationGroups(
  items: Item[],
  results: Result[],
  learners: Learner[],
): RemediationGroup[] {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const learnersById = new Map(learners.map((l) => [l.id, l]));

  const groups: Record<MasteryStatus, RemediationLearner[]> = {
    Mastered: [],
    "Near Mastery": [],
    "Needs Reinforcement": [],
    "Critical Support": [],
  };

  results.forEach((r) => {
    const learner = learnersById.get(r.learnerId);
    const entry: RemediationLearner = {
      name: learner ? learner.fullName : "(unknown learner)",
      percentage: r.percentage,
      weakCompetencies: weakCompetenciesFor(r, itemsById),
      action: ACTIONS[r.masteryStatus],
    };
    groups[r.masteryStatus].push(entry);
  });

  return GROUP_ORDER.map((status) => ({
    status,
    action: ACTIONS[status],
    learners: groups[status].sort((a, b) => b.percentage - a.percentage),
  }));
}

// ---- Mastery distribution ----------------------------------

export type MasteryDistribution = Record<MasteryStatus, number>;

export function masteryDistribution(results: Result[]): MasteryDistribution {
  const dist: MasteryDistribution = {
    Mastered: 0,
    "Near Mastery": 0,
    "Needs Reinforcement": 0,
    "Critical Support": 0,
  };
  results.forEach((r) => {
    dist[r.masteryStatus] += 1;
  });
  return dist;
}

// ---- Component summary (across all assessments) ------------

export interface ComponentRow {
  component: string;
  attempts: number;
  average: number;
  highest: number;
  lowest: number;
}

export function componentSummary(
  assessments: Assessment[],
  results: Result[],
): ComponentRow[] {
  const componentOf = new Map(assessments.map((a) => [a.id, a.component]));
  const groups = new Map<string, number[]>();

  results.forEach((r) => {
    const comp = componentOf.get(r.assessmentId);
    if (!comp) return;
    const list = groups.get(comp) ?? [];
    list.push(r.percentage);
    groups.set(comp, list);
  });

  return Array.from(groups.entries()).map(([component, pcts]) => {
    let sum = 0;
    let high = pcts[0];
    let low = pcts[0];
    pcts.forEach((p) => {
      sum += p;
      if (p > high) high = p;
      if (p < low) low = p;
    });
    return {
      component,
      attempts: pcts.length,
      average: round1(sum / pcts.length),
      highest: high,
      lowest: low,
    };
  });
}
