// Smart Test Import — safe upload → detect → validate → (preview) → confirm.
// Turns a CSV / Excel-saved-CSV / Word-structured / pasted questionnaire into
// structured, VALIDATED import rows with a per-item status + parsing-confidence
// score. Nothing is saved here: the UI shows a preview, the teacher fixes
// issues, and only then are Items + per-version keys built (buildItemsImport).
//
// SECURITY: answer letters populate the per-version key map only — never a QR.

import type {
  CognitiveLevel,
  Difficulty,
  Item,
  ItemType,
  TestVersion,
  VersionKey,
} from "./types";
import { COGNITIVE_LEVELS, DIFFICULTIES, ITEM_TYPES } from "./types";
import { isManual, isObjective, LETTERS, usesAcceptedAnswers } from "./items";
import { uid } from "./ids";
import { parseItemsCsv, type ParsedItem } from "./items-csv";
import { MAX_ITEMS } from "./scanner/omr-template";

// ---- Row + status model ------------------------------------

export type ImportStatus =
  | "ready" // no issues — safe to save
  | "review" // soft issues (missing optional data / low confidence)
  | "manual" // valid but scored manually (Essay, Problem Solving, …)
  | "error"; // a critical issue blocks saving

export interface ImportIssue {
  level: "critical" | "warn";
  text: string;
}

export interface ImportRow {
  key: string; // stable UI key
  itemNumber: number;
  type: ItemType;
  question: string;
  choices: number;
  points: number;
  competency: string;
  topic: string;
  difficulty: Difficulty;
  cognitiveLevel: CognitiveLevel | "";
  correctAnswer: string;
  acceptedAnswers: string[];
  explanation: string;
  manualCheck: boolean;
  // Objective answer letter per enabled version (A..D), when supplied.
  answers: Partial<Record<TestVersion, string>>;
  issues: ImportIssue[];
  status: ImportStatus;
  confidence: number; // 0..1 parsing confidence
}

export interface ImportSummary {
  rows: ImportRow[];
  versions: TestVersion[];
  detected: number;
  ready: number;
  review: number;
  manual: number;
  errors: number;
  skippedNumbers: number[];
  duplicateNumbers: number[];
  parseErrors: string[];
  // True while any row has a critical issue — final save is blocked.
  blocked: boolean;
}

export interface ImportContext {
  versions: TestVersion[]; // enabled versions on the active assessment
  sheetLimit?: number; // OMR item cap (default MAX_ITEMS)
}

const norm = (s: string): string => s.toLowerCase().replace(/[\s_]+/g, "");

// ---- Format sniffing ---------------------------------------

// CSV/TSV if the first non-empty line looks like a delimited header row with a
// recognizable column, otherwise treat the text as Word-structured blocks.
export function looksLikeCsv(text: string): boolean {
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  if (!/[,\t]/.test(first)) return false;
  const cells = first.split(/[,\t]/).map((c) => norm(c.trim()));
  return cells.some((c) =>
    ["question", "stem", "itemtype", "type", "correctanswer", "answer"].includes(c),
  );
}

// ---- Word / pasted structured-block parser -----------------
// A block is separated by a blank line and starts with a numbered stem:
//   1. What is a function?
//   A. ...  B. ...  C. ...  D. ...
//   Answer: B
//   Competency: ...   Difficulty: Easy   Cognitive Level: Understanding
//   Type: Multiple Choice   Points: 1

function matchEnum<T extends string>(raw: string, values: readonly T[]): T | "" {
  const n = norm(raw);
  return values.find((v) => norm(v) === n) ?? "";
}

const CHOICE_LINE = /^\s*([A-Ea-e])[.)]\s+(.*\S)\s*$/;
const NUM_LINE = /^\s*(\d{1,3})[.)]\s+(.*\S)\s*$/;
const FIELD_LINE = /^\s*([A-Za-z ]+?)\s*[:=]\s*(.+?)\s*$/;

function detectType(explicit: string, choiceCount: number, answer: string): ItemType {
  const t = matchEnum(explicit, ITEM_TYPES);
  if (t) return t;
  const a = answer.trim().toLowerCase();
  if (a === "true" || a === "false" || a === "t" || a === "f") return "True or False";
  if (choiceCount >= 2) return "Multiple Choice";
  if (answer.includes(",")) return "Enumeration";
  if (answer) return "Identification";
  return "Essay";
}

export function parseStructuredText(text: string): ParsedItem[] {
  const lines = text.split(/\r?\n/);
  const blocks: string[][] = [];
  let cur: string[] = [];
  for (const line of lines) {
    if (line.trim() === "") {
      if (cur.length) blocks.push(cur);
      cur = [];
    } else {
      cur.push(line);
    }
  }
  if (cur.length) blocks.push(cur);

  const items: ParsedItem[] = [];
  blocks.forEach((block, bi) => {
    let itemNumber = items.length + 1;
    let question = "";
    const choiceTexts: string[] = [];
    const fields: Record<string, string> = {};
    let answer = "";

    block.forEach((raw) => {
      const num = NUM_LINE.exec(raw);
      const ch = CHOICE_LINE.exec(raw);
      const fl = FIELD_LINE.exec(raw);
      if (num && question === "") {
        itemNumber = Number(num[1]);
        question = num[2];
      } else if (ch) {
        choiceTexts.push(ch[2]);
      } else if (fl) {
        const kf = norm(fl[1]);
        if (["answer", "correctanswer", "key"].includes(kf)) answer = fl[2].trim();
        else fields[kf] = fl[2].trim();
      } else if (question === "") {
        question = raw.trim();
      }
    });

    if (!question && choiceTexts.length === 0) return; // not an item block

    const explicitType = fields["type"] ?? fields["itemtype"] ?? "";
    const type = detectType(explicitType, choiceTexts.length, answer);
    const choices = Math.max(2, Math.min(choiceTexts.length || 4, LETTERS.length));
    const answers: Partial<Record<TestVersion, string>> = {};
    if (isObjective(type)) {
      let letter = answer.toUpperCase();
      if (type === "True or False") {
        letter = /^t/i.test(answer) ? "T" : /^f/i.test(answer) ? "F" : letter;
      }
      if (letter) answers.A = letter;
    }
    const acceptedAnswers = usesAcceptedAnswers(type)
      ? answer.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    items.push({
      itemNumber: Number.isInteger(itemNumber) && itemNumber > 0 ? itemNumber : bi + 1,
      type,
      question,
      choices,
      points: Number(fields["points"]) > 0 ? Number(fields["points"]) : 1,
      competency: fields["competency"] ?? fields["comp"] ?? "",
      topic: fields["topic"] ?? fields["lesson"] ?? "",
      difficulty: (matchEnum(fields["difficulty"] ?? "", DIFFICULTIES) || "Average") as Difficulty,
      cognitiveLevel: matchEnum(
        fields["cognitivelevel"] ?? fields["cognitive"] ?? fields["bloom"] ?? "",
        COGNITIVE_LEVELS,
      ),
      correctAnswer: isObjective(type) ? "" : answer,
      acceptedAnswers,
      answers,
    });
  });

  return items;
}

// ---- Unified parse (CSV or structured text) ----------------

// For objective items with no per-version key but a single "Correct Answer"
// letter, treat that letter as the version-A key (teachers often fill only the
// Correct Answer column). Text items keep correctAnswer as-is.
function backfillObjectiveAnswer(item: ParsedItem): ParsedItem {
  if (!isObjective(item.type)) return item;
  const hasAny = Object.values(item.answers).some((v) => v);
  const letter = item.correctAnswer.trim().toUpperCase();
  if (hasAny || !letter) return item;
  return { ...item, answers: { ...item.answers, A: letter }, correctAnswer: "" };
}

export function parseTestImport(text: string): { items: ParsedItem[]; versions: TestVersion[]; parseErrors: string[] } {
  if (looksLikeCsv(text)) {
    const res = parseItemsCsv(text);
    const items = res.items.map(backfillObjectiveAnswer);
    const fallback: TestVersion[] = items.some((i) => i.answers.A) ? ["A"] : [];
    const versions = res.versions.length ? res.versions : fallback;
    return { items, versions, parseErrors: res.errors };
  }
  const items = parseStructuredText(text);
  // Structured text carries a single answer -> version A only (mapped to all
  // enabled versions later by the key builder if needed).
  const versions: TestVersion[] = items.some((i) => i.answers.A) ? ["A"] : [];
  return { items, versions, parseErrors: [] };
}

// ---- Validation + confidence + status ----------------------

function letterInRange(letter: string, choices: number): boolean {
  const allowed = LETTERS.slice(0, Math.max(2, Math.min(choices, LETTERS.length)));
  return allowed.includes(letter.toUpperCase());
}

function assessRow(
  base: ParsedItem,
  ctx: ImportContext,
  seen: Set<number>,
): ImportRow {
  const issues: ImportIssue[] = [];
  const manualCheck = isManual(base.type);
  const wantsKey = isObjective(base.type);
  const wantsAccepted = usesAcceptedAnswers(base.type);
  const limit = ctx.sheetLimit ?? MAX_ITEMS;

  if (!base.question.trim()) issues.push({ level: "critical", text: "Missing question text." });

  if (seen.has(base.itemNumber)) {
    issues.push({ level: "critical", text: `Duplicate item number ${base.itemNumber}.` });
  }

  if ((base.type === "Multiple Choice" || base.type === "Matching Type") && base.choices < 2) {
    issues.push({ level: "critical", text: "Fewer than 2 choices." });
  }

  // Objective items need a valid key for at least the enabled versions.
  if (wantsKey && base.type !== "True or False") {
    const supplied = Object.entries(base.answers).filter(([, v]) => v);
    if (supplied.length === 0) {
      issues.push({ level: "critical", text: "Missing correct answer (answer key)." });
    }
    supplied.forEach(([v, letter]) => {
      if (!letterInRange(letter as string, base.choices)) {
        issues.push({
          level: "critical",
          text: `Version ${v} answer "${letter}" is outside choices A–${LETTERS[base.choices - 1]}.`,
        });
      }
    });
  }
  if (base.type === "True or False" && !base.answers.A) {
    issues.push({ level: "critical", text: "Missing True/False answer." });
  }
  if (wantsAccepted && base.acceptedAnswers.length === 0 && !base.correctAnswer.trim()) {
    issues.push({ level: "warn", text: "No accepted answer(s) provided for text item." });
  }

  if (base.itemNumber > limit) {
    issues.push({ level: "warn", text: `Item ${base.itemNumber} exceeds the ${limit}-item sheet limit.` });
  }
  if (!base.competency.trim()) issues.push({ level: "warn", text: "No competency tag." });

  const critical = issues.some((i) => i.level === "critical");
  const warns = issues.filter((i) => i.level === "warn").length;

  // Confidence: full marks minus penalties. Deterministic + explainable.
  let confidence = 1;
  confidence -= issues.filter((i) => i.level === "critical").length * 0.4;
  confidence -= warns * 0.08;
  if (!base.difficulty) confidence -= 0.02;
  if (!base.cognitiveLevel) confidence -= 0.02;
  confidence = Math.max(0.2, Math.min(1, Math.round(confidence * 100) / 100));

  let status: ImportStatus;
  if (critical) status = "error";
  else if (manualCheck) status = "manual";
  else if (warns > 0 || confidence < 0.95) status = "review";
  else status = "ready";

  seen.add(base.itemNumber);
  return {
    key: "row_" + base.itemNumber + "_" + Math.random().toString(36).slice(2, 7),
    itemNumber: base.itemNumber,
    type: base.type,
    question: base.question,
    choices: base.choices,
    points: base.points,
    competency: base.competency,
    topic: base.topic,
    difficulty: base.difficulty,
    cognitiveLevel: base.cognitiveLevel,
    correctAnswer: base.correctAnswer,
    acceptedAnswers: base.acceptedAnswers,
    explanation: "",
    manualCheck,
    answers: base.answers,
    issues,
    status,
    confidence,
  };
}

// Full pipeline: parse + validate + summarize. `blocked` gates the save.
export function importTest(text: string, ctx: ImportContext): ImportSummary {
  const { items, versions, parseErrors } = parseTestImport(text);
  const seen = new Set<number>();
  const rows = items.map((it) => assessRow(it, ctx, seen));

  const numbers = rows.map((r) => r.itemNumber).filter((n) => n > 0);
  const max = numbers.length ? Math.max(...numbers) : 0;
  const present = new Set(numbers);
  const skippedNumbers: number[] = [];
  for (let n = 1; n <= max; n += 1) if (!present.has(n)) skippedNumbers.push(n);

  const counts = new Map<number, number>();
  numbers.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
  const duplicateNumbers = [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n);

  return {
    rows,
    versions: versions.length ? versions : ctx.versions,
    detected: rows.length,
    ready: rows.filter((r) => r.status === "ready").length,
    review: rows.filter((r) => r.status === "review").length,
    manual: rows.filter((r) => r.status === "manual").length,
    errors: rows.filter((r) => r.status === "error").length,
    skippedNumbers,
    duplicateNumbers,
    parseErrors,
    blocked: rows.some((r) => r.issues.some((i) => i.level === "critical")),
  };
}

// Build real Items + per-version answer keys from confirmed preview rows.
// A single objective answer (answers.A only) is applied to every enabled
// version, since the teacher supplied one correct answer for the item.
export interface BuiltImport {
  items: Item[];
  keys: Partial<Record<TestVersion, VersionKey>>;
}

export function buildImport(
  assessmentId: string,
  rows: ImportRow[],
  enabledVersions: TestVersion[],
): BuiltImport {
  const keys: Partial<Record<TestVersion, VersionKey>> = {};
  const items: Item[] = rows.map((r) => {
    const id = uid("I_");
    if (isObjective(r.type)) {
      const suppliedVersions = (Object.keys(r.answers) as TestVersion[]).filter((v) => r.answers[v]);
      // Single answer -> broadcast to all enabled versions; else use as given.
      const single = suppliedVersions.length === 1 && suppliedVersions[0] === "A" ? r.answers.A : null;
      const targets = single ? enabledVersions : suppliedVersions;
      targets.forEach((v) => {
        const letter = single ?? r.answers[v];
        if (!letter) return;
        if (!keys[v]) keys[v] = {};
        (keys[v] as VersionKey)[id] = letter;
      });
    }
    return {
      id,
      assessmentId,
      itemNumber: r.itemNumber,
      type: r.type,
      question: r.question,
      correctAnswer: r.correctAnswer,
      acceptedAnswers: r.acceptedAnswers,
      points: r.points,
      competency: r.competency,
      topic: r.topic,
      difficulty: r.difficulty,
      cognitiveLevel: r.cognitiveLevel,
      choices: r.choices,
      explanation: r.explanation,
    };
  });
  return { items, keys };
}

// Re-validate a single edited row (used by the preview table on edit).
export function revalidateRow(row: ImportRow, ctx: ImportContext, otherNumbers: number[]): ImportRow {
  const base: ParsedItem = {
    itemNumber: row.itemNumber,
    type: row.type,
    question: row.question,
    choices: row.choices,
    points: row.points,
    competency: row.competency,
    topic: row.topic,
    difficulty: row.difficulty,
    cognitiveLevel: row.cognitiveLevel,
    correctAnswer: row.correctAnswer,
    acceptedAnswers: row.acceptedAnswers,
    answers: row.answers,
  };
  const seen = new Set(otherNumbers);
  const next = assessRow(base, ctx, seen);
  return { ...next, key: row.key, explanation: row.explanation };
}
