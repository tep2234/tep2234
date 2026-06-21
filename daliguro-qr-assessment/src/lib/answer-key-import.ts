// Bulk answer-key CSV import (pure logic, testable).
// Header: Item No, Version, Answer
// Keys are applied per version. They are NEVER embedded in QR codes.

import type { TestVersion } from "./types";
import { TEST_VERSIONS } from "./types";
import { headerIndex, splitCsvLine } from "./csv";

export interface ParsedKeyEntry {
  row: number;
  itemNumber: number;
  version: TestVersion;
  answer: string;
}

export interface KeyImportResult {
  rows: ParsedKeyEntry[];
  errors: string[];
}

function matchVersion(raw: string): TestVersion | null {
  const s = raw.trim().toUpperCase();
  return (TEST_VERSIONS as readonly string[]).includes(s)
    ? (s as TestVersion)
    : null;
}

export function parseAnswerKeyCsv(text: string): KeyImportResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], errors: ["Need a header row plus at least one key row."] };
  }

  const header = splitCsvLine(lines[0]);
  const at = headerIndex(header);
  const iItem = at(["item no", "item number", "no", "item", "#"]);
  const iVersion = at(["version", "ver"]);
  const iAnswer = at(["answer", "key", "correct answer"]);

  const errors: string[] = [];
  if (iItem < 0 || iVersion < 0 || iAnswer < 0) {
    errors.push("Header must include Item No, Version, and Answer columns.");
    return { rows: [], errors };
  }

  const rows: ParsedKeyEntry[] = [];
  for (let r = 1; r < lines.length; r += 1) {
    const cols = splitCsvLine(lines[r]);
    const itemNumber = Number((cols[iItem] ?? "").trim());
    if (!Number.isInteger(itemNumber) || itemNumber < 1) {
      errors.push(`Row ${r + 1}: invalid item number — skipped.`);
      continue;
    }
    const version = matchVersion(cols[iVersion] ?? "");
    if (!version) {
      errors.push(`Row ${r + 1}: invalid version "${cols[iVersion] ?? ""}" — skipped.`);
      continue;
    }
    const answer = (cols[iAnswer] ?? "").trim();
    if (!answer) {
      errors.push(`Row ${r + 1}: empty answer — skipped.`);
      continue;
    }
    rows.push({ row: r + 1, itemNumber, version, answer });
  }

  return { rows, errors };
}
