// Learner CSV import (pure logic, testable).
// Header: LRN, Full Name, Sex, Grade Level, Section
// Improvements over the original parser:
//  - Sex accepts M / F / Male / Female (normalised to M/F)
//  - quoted names with commas are preserved
//  - duplicate LRNs are detected (caller decides skip vs update)

import type { Sex } from "./types";
import { headerIndex, splitCsvLine } from "./csv";

export interface ParsedLearner {
  row: number; // 1-based source row (for preview/error messages)
  lrn: string;
  fullName: string;
  sex: Sex;
  gradeLevel: string;
  section: string;
}

export interface LearnerImportResult {
  rows: ParsedLearner[];
  errors: string[];
}

// Normalise a free-form sex value to the internal M/F. Defaults to M.
export function normalizeSex(raw: string): Sex {
  const s = raw.trim().toLowerCase();
  if (s === "f" || s === "female") return "F";
  return "M";
}

export function parseLearnersCsv(text: string): LearnerImportResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const errors: string[] = [];
  if (lines.length < 2) {
    return {
      rows: [],
      errors: ["Need a header row plus at least one learner row."],
    };
  }

  const header = splitCsvLine(lines[0]);
  const at = headerIndex(header);
  const iLrn = at(["lrn"]);
  const iName = at(["full name", "name", "fullname"]);
  const iSex = at(["sex", "gender"]);
  const iGrade = at(["grade level", "grade"]);
  const iSection = at(["section"]);

  const rows: ParsedLearner[] = [];
  for (let r = 1; r < lines.length; r += 1) {
    const cols = splitCsvLine(lines[r]);
    const fullName = (iName >= 0 ? cols[iName] : cols[0]) ?? "";
    if (!fullName.trim()) {
      errors.push(`Row ${r + 1}: missing Full Name — skipped.`);
      continue;
    }
    rows.push({
      row: r + 1,
      lrn: (iLrn >= 0 ? cols[iLrn] : "") ?? "",
      fullName: fullName.trim(),
      sex: normalizeSex(iSex >= 0 ? cols[iSex] ?? "" : ""),
      gradeLevel: (iGrade >= 0 ? cols[iGrade] : "") || "11",
      section: (iSection >= 0 ? cols[iSection] : "") ?? "",
    });
  }
  return { rows, errors };
}

// Mark rows whose (non-empty) LRN already exists among existingLrns.
export function flagDuplicateLrns(
  rows: ParsedLearner[],
  existingLrns: Iterable<string>,
): { duplicates: ParsedLearner[]; fresh: ParsedLearner[] } {
  const taken = new Set<string>();
  for (const l of existingLrns) if (l.trim()) taken.add(l.trim());
  const duplicates: ParsedLearner[] = [];
  const fresh: ParsedLearner[] = [];
  rows.forEach((r) => {
    if (r.lrn.trim() && taken.has(r.lrn.trim())) duplicates.push(r);
    else fresh.push(r);
  });
  return { duplicates, fresh };
}
