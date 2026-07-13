// SmartScan insights — pure analytics on top of analysis.ts.
// Discrimination index, item quality flags, learning attention flags, and the
// rule-based Smart Teacher Summary / reflection text. No AI claims: every
// statement here is derived from observable performance data.

import type { Assessment, Item, Learner, Result } from "./types";
import type { CompetencyRow, ItemAnalysisRow, WrongAnswerTally } from "./analysis";

export const PASSING_PERCENT = 75;

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// ---- Class stats -------------------------------------------

export interface ClassStats {
  count: number;
  average: number;
  highest: number;
  lowest: number;
  passingRate: number; // % of results at or above PASSING_PERCENT
}

export function classStats(results: Result[]): ClassStats {
  if (results.length === 0) {
    return { count: 0, average: 0, highest: 0, lowest: 0, passingRate: 0 };
  }
  let sum = 0;
  let high = results[0].percentage;
  let low = results[0].percentage;
  let passing = 0;
  results.forEach((r) => {
    sum += r.percentage;
    if (r.percentage > high) high = r.percentage;
    if (r.percentage < low) low = r.percentage;
    if (r.percentage >= PASSING_PERCENT) passing += 1;
  });
  return {
    count: results.length,
    average: round1(sum / results.length),
    highest: high,
    lowest: low,
    passingRate: round1((passing / results.length) * 100),
  };
}

// ---- Discrimination index ----------------------------------
// Classic upper/lower 27% method: how much better the top scorers do on an
// item than the bottom scorers. Near or below 0 on a hard item is a red flag
// (possible key error or confusing wording). Needs a few results to mean
// anything — returns null below 4 attempts.

export function discriminationIndex(itemId: string, results: Result[]): number | null {
  const attempted = results.filter((r) =>
    r.itemScores.some((s) => s.itemId === itemId && !s.unresolved),
  );
  if (attempted.length < 4) return null;
  const sorted = [...attempted].sort((a, b) => b.percentage - a.percentage);
  const g = Math.max(1, Math.round(sorted.length * 0.27));
  const top = sorted.slice(0, g);
  const bottom = sorted.slice(-g);
  const correctIn = (group: Result[]) =>
    group.filter((r) => {
      const s = r.itemScores.find((x) => x.itemId === itemId);
      return !!s && !s.unresolved && !s.blank && !s.manual && s.correct;
    }).length;
  return round1((correctIn(top) - correctIn(bottom)) / g);
}

// ---- Item quality flags ------------------------------------

export function itemQualityFlags(
  row: ItemAnalysisRow,
  discrimination: number | null,
  wrongTally: WrongAnswerTally[] | undefined,
): string[] {
  const flags: string[] = [];
  if (row.attempts < 4) return flags; // not enough data to judge the item

  if (row.percentCorrect < 20) {
    flags.push("Very low correct rate — check the answer key and wording.");
  }
  if (discrimination !== null && discrimination <= 0 && row.percentCorrect < 60) {
    flags.push(
      "High scorers missed it as often as low scorers — possible key error or unclear item.",
    );
  }
  const topWrong = wrongTally?.[0];
  if (topWrong && row.incorrect > 0 && topWrong.count >= Math.max(2, row.attempts * 0.5)) {
    flags.push(
      `Most learners chose the same wrong answer ("${topWrong.response}") — likely a shared misconception or a key mismatch.`,
    );
  }
  if (row.percentCorrect === 100) {
    flags.push("Everyone answered correctly — the item may be too easy to discriminate.");
  }
  if (row.blank >= Math.max(2, row.attempts * 0.4)) {
    flags.push("Many learners left this blank — check for confusing wording or time pressure.");
  }
  return flags;
}

// ---- Learning attention flags ------------------------------
// Performance-based only. This does NOT measure attention directly; it flags
// observable patterns (low completion, low mastery, patterned answering).

export const ATTENTION_FLAGS = [
  "On Track",
  "Needs Monitoring",
  "Needs Support",
  "Needs Immediate Remediation",
] as const;
export type AttentionFlag = (typeof ATTENTION_FLAGS)[number];

export interface AttentionReading {
  flag: AttentionFlag;
  reasons: string[];
}

// Longest run of the same non-blank letter in item order.
function longestSameRun(result: Result): number {
  let best = 0;
  let run = 0;
  let last = "";
  result.answers.forEach((a) => {
    const v = a.response.trim().toUpperCase();
    if (v !== "" && v === last) {
      run += 1;
    } else {
      run = v === "" ? 0 : 1;
      last = v;
    }
    if (run > best) best = run;
  });
  return best;
}

export function attentionFor(result: Result, itemsById: Map<string, Item>): AttentionReading {
  const reasons: string[] = [];
  const auto = result.itemScores.filter((s) => !s.manual && !s.unresolved);
  const blanks = auto.filter((s) => s.blank).length;
  const blankRatio = auto.length > 0 ? blanks / auto.length : 0;
  const missedEasy = auto.filter((s) => {
    const item = itemsById.get(s.itemId);
    return item?.difficulty === "Easy" && !s.blank && !s.correct;
  }).length;
  const run = longestSameRun(result);

  if (blanks > 0) reasons.push(`${blanks} item(s) left blank`);
  if (run >= 6) reasons.push(`answered the same letter ${run} times in a row`);
  if (missedEasy >= 2) reasons.push(`missed ${missedEasy} easy item(s)`);
  reasons.push(`scored ${result.percentage}%`);

  let flag: AttentionFlag = "On Track";
  if (result.percentage < 40 || blankRatio >= 0.4) {
    flag = "Needs Immediate Remediation";
  } else if (result.percentage < 60 || blankRatio >= 0.25 || run >= 6) {
    flag = "Needs Support";
  } else if (result.percentage < 80 || missedEasy >= 2 || blanks > 0) {
    flag = "Needs Monitoring";
  }
  return { flag, reasons };
}

// ---- Smart Teacher Summary ---------------------------------

export interface SummaryInput {
  assessment: Assessment;
  results: Result[];
  learners: Learner[];
  itemRows: ItemAnalysisRow[];
  competencyRows: CompetencyRow[];
}

function names(results: Result[], learners: Learner[]): string[] {
  const byId = new Map(learners.map((l) => [l.id, l.fullName]));
  return results.map((r) => byId.get(r.learnerId) ?? "(unknown learner)");
}

function listOf(values: string[], max = 5): string {
  if (values.length <= max) return values.join(", ");
  return values.slice(0, max).join(", ") + ` and ${values.length - max} more`;
}

export function buildSmartSummary(input: SummaryInput): string {
  const { assessment, results, learners, itemRows, competencyRows } = input;
  if (results.length === 0) {
    return `No checked results yet for “${assessment.title}”. Scan or check answer sheets first.`;
  }
  const stats = classStats(results);
  const attempted = itemRows.filter((r) => r.attempts > 0);
  const strong = attempted.filter((r) => r.percentCorrect >= 80);
  const weak = [...attempted]
    .sort((a, b) => a.percentCorrect - b.percentCorrect)
    .filter((r) => r.percentCorrect < 60)
    .slice(0, 3);
  const weakComps = competencyRows.filter((c) => c.masteryPercent < 75).slice(0, 2);
  const critical = results.filter((r) => r.masteryStatus === "Critical Support");
  const reinforce = results.filter((r) => r.masteryStatus === "Needs Reinforcement");
  const mastered = results.filter((r) => r.masteryStatus === "Mastered");

  const parts: string[] = [];
  parts.push(
    `The class scored an average of ${stats.average}% on “${assessment.title}” ` +
      `(${stats.count} learner(s) checked, passing rate ${stats.passingRate}%).`,
  );
  if (strong.length > 0) {
    parts.push(
      `Learners performed well on item(s) ${listOf(strong.map((r) => String(r.item.itemNumber)))}.`,
    );
  }
  if (weak.length > 0) {
    parts.push(
      `Item(s) ${weak.map((r) => String(r.item.itemNumber)).join(", ")} showed low mastery` +
        (weakComps.length > 0
          ? `, mostly under “${weakComps.map((c) => c.competency).join("” and “")}”.`
          : "."),
    );
  }
  if (critical.length > 0 || reinforce.length > 0) {
    const bits: string[] = [];
    if (critical.length > 0) {
      bits.push(
        `${critical.length} learner(s) need immediate remediation (${listOf(names(critical, learners))})`,
      );
    }
    if (reinforce.length > 0) bits.push(`${reinforce.length} learner(s) need guided practice`);
    parts.push(bits.join("; ") + ".");
  }
  const action =
    weakComps.length > 0
      ? `Recommended next action: conduct a short focused reteaching activity on “${weakComps[0].competency}” before the next lesson` +
        (mastered.length > 0
          ? `, while learners who mastered the assessment take an enrichment task.`
          : ".")
      : `Recommended next action: proceed to the next lesson; give the flagged learners a short review set.`;
  parts.push(action);
  return parts.join(" ");
}

// Teacher reflection blurb (for DLL reflection / intervention documentation).
export function buildReflection(input: SummaryInput): string {
  const { results, competencyRows } = input;
  if (results.length === 0) return "No results to reflect on yet.";
  const stats = classStats(results);
  const weakest = competencyRows[0];
  const dist = {
    m: results.filter((r) => r.masteryStatus === "Mastered").length,
    nm: results.filter((r) => r.masteryStatus === "Near Mastery").length,
    nr: results.filter((r) => r.masteryStatus === "Needs Reinforcement").length,
    cs: results.filter((r) => r.masteryStatus === "Critical Support").length,
  };
  return (
    `Out of ${stats.count} learner(s) assessed, ${dist.m} mastered the competencies, ` +
    `${dist.nm} were nearly there, ${dist.nr} need reinforcement, and ${dist.cs} need critical support. ` +
    `The class average was ${stats.average}% with a passing rate of ${stats.passingRate}%. ` +
    (weakest
      ? `The weakest area was “${weakest.competency}” (${weakest.masteryPercent}% mastery); ` +
        `I will address this through targeted remediation grouped by mastery level before moving on.`
      : `I will proceed to the next lesson with a short review for flagged learners.`)
  );
}
