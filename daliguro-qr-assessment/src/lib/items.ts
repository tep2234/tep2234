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

// Normalise a free-text answer for tolerant comparison.
export function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function parseAccepted(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
