// Helpers for item option sets and answer handling.
// Shared by the item editor, answer-key editor, checking, and scoring.

import type { Item, ItemType } from "./types";
import { OBJECTIVE_ITEM_TYPES } from "./types";

export const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export function isObjective(type: ItemType): boolean {
  return OBJECTIVE_ITEM_TYPES.includes(type);
}

// Items that accept free-text answers checked against acceptedAnswers.
const TEXT_ACCEPT_TYPES: ItemType[] = [
  "Identification",
  "Fill in the Blank",
  "Short Answer",
];

export function usesAcceptedAnswers(type: ItemType): boolean {
  return TEXT_ACCEPT_TYPES.includes(type);
}

// Items scored manually by the teacher (no auto-scoring).
export function isManual(type: ItemType): boolean {
  return !isObjective(type) && !usesAcceptedAnswers(type);
}

export type ScoringMode = "objective" | "text" | "manual";

// Single source of truth for how an item is scored. Used for UI labelling
// and to keep classification consistent everywhere.
export function scoringMode(type: ItemType): ScoringMode {
  if (isObjective(type)) return "objective";
  if (usesAcceptedAnswers(type)) return "text";
  return "manual";
}

const SCORING_MODE_LABEL: Record<ScoringMode, string> = {
  objective: "auto · objective",
  text: "auto · accepted answers",
  manual: "manual",
};

export function scoringModeLabel(type: ItemType): string {
  return SCORING_MODE_LABEL[scoringMode(type)];
}

// True for item types that carry A/B/C/D… option text (Multiple Choice / Matching).
export function hasOptionText(type: ItemType): boolean {
  return type === "Multiple Choice" || type === "Matching Type";
}

// Returns the fixed choice set for button-style objective items,
// or null when the answer is entered as free text (e.g. Sequencing).
export function optionSet(item: Item): string[] | null {
  if (item.type === "True or False") return ["T", "F"];
  if (item.type === "Multiple Choice" || item.type === "Matching Type") {
    const n = Math.max(2, Math.min(item.choices, LETTERS.length));
    return LETTERS.slice(0, n);
  }
  return null;
}

// Pair each option letter with its text (text may be "" if not yet filled in).
export function optionPairs(item: Item): { letter: string; text: string }[] {
  const letters = optionSet(item);
  if (!letters) return [];
  return letters.map((letter, i) => ({
    letter,
    text: item.options?.[i] ?? "",
  }));
}

// Normalise a free-text answer for tolerant comparison (case + whitespace).
export function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// Looser normalisation: lowercase, strip punctuation to spaces, collapse spaces.
// "Target-Market!" -> "target market"
export function looseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Compact form: only alphanumerics, no spaces. "target market" -> "targetmarket"
export function compactText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gi, "");
}

// Teacher-friendly accepted-answer match. Matches on the loose form OR the
// compact (spaceless) form, so "target market", "TARGET MARKET",
// "target-market", "target_market", and "TARGETMARKET" all match each other.
export function acceptedMatch(response: string, accepted: string[]): boolean {
  const rLoose = looseText(response);
  const rCompact = compactText(response);
  if (rLoose === "" && rCompact === "") return false;
  return accepted.some((a) => {
    const aLoose = looseText(a);
    const aCompact = compactText(a);
    return (
      (aLoose !== "" && aLoose === rLoose) ||
      (aCompact !== "" && aCompact === rCompact)
    );
  });
}

export function parseAccepted(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
