// Items + answer-key CSV import (pure, testable).
// Accepts a teacher-authored item bank as CSV and turns it into Item objects
// plus per-version answer keys. SECURITY: answer letters go ONLY into the
// returned per-version key map (state.answerKeys) — never into a QR.
//
// Recognised columns (case-insensitive, spaces/underscores ignored):
//   itemNo | no | number | #            -> item number (optional; else row order)
//   type | itemType                     -> item type (default "Multiple Choice")
//   question | stem                     -> question text (required)
//   optionA..optionH | "A".."H"         -> choice texts (count drives `choices`)
//   points | pts                        -> points (default 1)
//   competency | comp                   -> competency code/label
//   difficulty | diff                   -> Easy | Average | Difficult
//   correctAnswer | answer | key        -> single-version key / text answer
//   acceptedAnswers | accepted          -> extra accepted text answers (comma)
//   answerVersionA | versionA | keyA …  -> objective key for version A..D

import type { Difficulty, Item, ItemType, TestVersion, VersionKey } from "./types";
import { DIFFICULTIES, ITEM_TYPES, TEST_VERSIONS } from "./types";
import { isObjective, LETTERS } from "./items";
import { uid } from "./ids";

export interface ParsedItem {
  itemNumber: number;
  type: ItemType;
  question: string;
  choices: number;
  points: number;
  competency: string;
  difficulty: Difficulty;
  correctAnswer: string;
  acceptedAnswers: string[];
  // Objective answer letter per version, e.g. { A: "B", B: "D" }.
  answers: Partial<Record<TestVersion, string>>;
}

export interface ParseResult {
  items: ParsedItem[];
  versions: TestVersion[];
  errors: string[];
}

export interface BuiltImport {
  items: Item[];
  keys: Partial<Record<TestVersion, VersionKey>>;
}

// Split one CSV line, tolerating simple double-quoted fields.
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const norm = (h: string) => h.toLowerCase().replace(/[\s_]+/g, "");

function matchType(raw: string): ItemType {
  const n = norm(raw);
  const found = ITEM_TYPES.find((t) => norm(t) === n);
  return found ?? "Multiple Choice";
}

function matchDifficulty(raw: string): Difficulty {
  const n = norm(raw);
  const found = DIFFICULTIES.find((d) => norm(d) === n);
  return found ?? "Average";
}

interface ColumnMap {
  itemNo: number;
  type: number;
  question: number;
  points: number;
  competency: number;
  difficulty: number;
  correctAnswer: number;
  acceptedAnswers: number;
  options: number[]; // index by option position (0=A,1=B,…)
  versions: Partial<Record<TestVersion, number>>;
}

function buildColumnMap(header: string[]): ColumnMap {
  const map: ColumnMap = {
    itemNo: -1,
    type: -1,
    question: -1,
    points: -1,
    competency: -1,
    difficulty: -1,
    correctAnswer: -1,
    acceptedAnswers: -1,
    options: [],
    versions: {},
  };
  const optionByLetter: Record<string, number> = {};
  const versionByLetter: Partial<Record<TestVersion, number>> = {};

  header.forEach((raw, idx) => {
    const h = norm(raw);
    if (["itemno", "no", "number", "itemnumber", "#"].includes(h)) map.itemNo = idx;
    else if (["type", "itemtype"].includes(h)) map.type = idx;
    else if (["question", "stem"].includes(h)) map.question = idx;
    else if (["points", "point", "pts"].includes(h)) map.points = idx;
    else if (["competency", "comp", "competencycode"].includes(h)) map.competency = idx;
    else if (["difficulty", "diff"].includes(h)) map.difficulty = idx;
    else if (["correctanswer", "answer", "key"].includes(h)) map.correctAnswer = idx;
    else if (["acceptedanswers", "accepted", "alternates"].includes(h))
      map.acceptedAnswers = idx;
    else {
      // Per-version objective key: answerVersionA | versionA | keyA | answera
      const ver = h.match(/^(?:answerversion|version|key|answer)([a-d])$/);
      if (ver) {
        versionByLetter[ver[1].toUpperCase() as TestVersion] = idx;
        return;
      }
      // Option columns: optionA | "A" (single letter)
      const opt = h.match(/^(?:option)?([a-h])$/);
      if (opt) optionByLetter[opt[1].toUpperCase()] = idx;
    }
  });

  // Order options A..H by their letter.
  LETTERS.forEach((L) => {
    if (optionByLetter[L] !== undefined) map.options.push(optionByLetter[L]);
  });
  map.versions = versionByLetter;
  return map;
}

export function parseItemsCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const errors: string[] = [];
  if (lines.length < 2) {
    return { items: [], versions: [], errors: ["CSV needs a header row and at least one item."] };
  }

  const header = splitCsvLine(lines[0]);
  const col = buildColumnMap(header);
  if (col.question === -1) {
    errors.push('Missing a "question" column.');
    return { items: [], versions: [], errors };
  }

  const versionsPresent = (Object.keys(col.versions) as TestVersion[]).filter((v) =>
    (TEST_VERSIONS as readonly string[]).includes(v),
  );

  const items: ParsedItem[] = [];
  const seenNumbers = new Set<number>();

  for (let r = 1; r < lines.length; r += 1) {
    const cells = splitCsvLine(lines[r]);
    const at = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    const rowLabel = "Row " + (r + 1);

    const question = at(col.question);
    if (!question) {
      errors.push(rowLabel + ": skipped (no question).");
      continue;
    }

    const type = col.type >= 0 ? matchType(at(col.type)) : "Multiple Choice";

    let itemNumber = items.length + 1;
    const rawNo = at(col.itemNo);
    if (rawNo) {
      const n = Number(rawNo);
      if (Number.isInteger(n) && n > 0) itemNumber = n;
    }
    if (seenNumbers.has(itemNumber)) {
      errors.push(rowLabel + ': duplicate item number ' + itemNumber + " (kept; please review).");
    }
    seenNumbers.add(itemNumber);

    const optionCount = col.options.filter((i) => at(i) !== "").length;
    const choices = Math.max(2, Math.min(optionCount || 4, LETTERS.length));

    const points = (() => {
      const p = Number(at(col.points));
      return Number.isFinite(p) && p > 0 ? p : 1;
    })();

    const acceptedAnswers = at(col.acceptedAnswers)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const answers: Partial<Record<TestVersion, string>> = {};
    versionsPresent.forEach((v) => {
      const idx = col.versions[v];
      const val = idx === undefined ? "" : at(idx);
      if (!val) return;
      const letter = val.toUpperCase();
      if (isObjective(type)) {
        const valid = optionCount === 0 || LETTERS.slice(0, choices).includes(letter);
        if (!valid) {
          errors.push(
            rowLabel + ": version " + v + ' answer "' + val + '" is outside choices A–' +
              LETTERS[choices - 1] + ".",
          );
          return;
        }
      }
      answers[v] = letter;
    });

    items.push({
      itemNumber,
      type,
      question,
      choices,
      points,
      competency: at(col.competency),
      difficulty: col.difficulty >= 0 ? matchDifficulty(at(col.difficulty)) : "Average",
      correctAnswer: at(col.correctAnswer),
      acceptedAnswers,
      answers,
    });
  }

  return { items, versions: versionsPresent, errors };
}

// Turn parsed rows into real Item objects + per-version answer keys.
export function buildItemsImport(
  assessmentId: string,
  parsed: ParsedItem[],
): BuiltImport {
  const keys: Partial<Record<TestVersion, VersionKey>> = {};
  const items: Item[] = parsed.map((p) => {
    const id = uid("I_");
    (Object.keys(p.answers) as TestVersion[]).forEach((v) => {
      const letter = p.answers[v];
      if (!letter) return;
      if (!keys[v]) keys[v] = {};
      (keys[v] as VersionKey)[id] = letter;
    });
    return {
      id,
      assessmentId,
      itemNumber: p.itemNumber,
      type: p.type,
      question: p.question,
      correctAnswer: p.correctAnswer,
      acceptedAnswers: p.acceptedAnswers,
      points: p.points,
      competency: p.competency,
      difficulty: p.difficulty,
      choices: p.choices,
    };
  });
  return { items, keys };
}
