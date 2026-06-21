// Bulk item CSV import (pure logic, testable).
// Header (order-independent, aliases allowed):
//   Item No,Type,Question,A,B,C,D,E,Correct Answer,Accepted Answers,
//   Points,Competency,Difficulty

import type { Difficulty, ItemType } from "./types";
import { DIFFICULTIES, ITEM_TYPES } from "./types";
import { hasOptionText } from "./items";
import { headerIndex, splitCsvLine } from "./csv";

export interface ParsedItem {
  row: number;
  type: ItemType;
  question: string;
  options: string[];
  choices: number;
  correctAnswer: string;
  acceptedAnswers: string[];
  points: number;
  competency: string;
  difficulty: Difficulty;
  warnings: string[];
}

export interface ItemImportResult {
  rows: ParsedItem[];
  errors: string[];
}

function matchType(raw: string): ItemType | null {
  const s = raw.trim().toLowerCase();
  return ITEM_TYPES.find((t) => t.toLowerCase() === s) ?? null;
}

function matchDifficulty(raw: string): Difficulty {
  const s = raw.trim().toLowerCase();
  return DIFFICULTIES.find((d) => d.toLowerCase() === s) ?? "Average";
}

export function parseItemsCsv(text: string): ItemImportResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ["Need a header row plus at least one item row."] };
  }

  const header = splitCsvLine(lines[0]);
  const at = headerIndex(header);
  const iType = at(["type"]);
  const iQuestion = at(["question"]);
  const iA = at(["a"]);
  const iB = at(["b"]);
  const iC = at(["c"]);
  const iD = at(["d"]);
  const iE = at(["e"]);
  const iCorrect = at(["correct answer", "answer", "key"]);
  const iAccepted = at(["accepted answers", "accepted"]);
  const iPoints = at(["points", "pts"]);
  const iCompetency = at(["competency"]);
  const iDifficulty = at(["difficulty"]);

  const errors: string[] = [];
  if (iType < 0 || iQuestion < 0) {
    errors.push("Header must include at least Type and Question columns.");
    return { rows: [], errors };
  }

  const get = (cols: string[], idx: number) => (idx >= 0 ? cols[idx] ?? "" : "");
  const rows: ParsedItem[] = [];

  for (let r = 1; r < lines.length; r += 1) {
    const cols = splitCsvLine(lines[r]);
    const typeRaw = get(cols, iType);
    const type = matchType(typeRaw);
    if (!type) {
      errors.push(`Row ${r + 1}: unknown item type "${typeRaw}" — skipped.`);
      continue;
    }

    const warnings: string[] = [];
    const question = get(cols, iQuestion).trim();
    if (!question) warnings.push("no question text");

    const optionTexts = [
      get(cols, iA),
      get(cols, iB),
      get(cols, iC),
      get(cols, iD),
      get(cols, iE),
    ].map((s) => s.trim());

    // Trim trailing empty option cells so "choices" reflects real options.
    let lastFilled = -1;
    optionTexts.forEach((t, i) => {
      if (t) lastFilled = i;
    });
    const options = hasOptionText(type) ? optionTexts.slice(0, Math.max(2, lastFilled + 1)) : [];
    const choices = hasOptionText(type)
      ? Math.min(5, Math.max(2, options.length))
      : 4;
    if (hasOptionText(type) && lastFilled < 0) warnings.push("no option text");

    const pointsRaw = get(cols, iPoints).trim();
    let points = Number(pointsRaw);
    if (!Number.isFinite(points)) points = 1;
    if (points <= 0) warnings.push("zero/invalid points");
    points = Math.max(0, Math.round(points));

    const acceptedAnswers = get(cols, iAccepted)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    rows.push({
      row: r + 1,
      type,
      question,
      options,
      choices,
      correctAnswer: get(cols, iCorrect).trim(),
      acceptedAnswers,
      points,
      competency: get(cols, iCompetency).trim(),
      difficulty: matchDifficulty(get(cols, iDifficulty)),
      warnings,
    });
  }

  return { rows, errors };
}
