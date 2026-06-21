// Minimal CSV parsing shared by the learner / item / answer-key importers.
// Tolerates simple quoted fields (commas and escaped "" inside quotes).

// Split one CSV line into fields, respecting double-quoted sections.
export function splitCsvLine(line: string): string[] {
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

// Split CSV text into non-empty rows of fields.
export function splitCsvRows(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map(splitCsvLine);
}

// Build a case-insensitive header -> index lookup, accepting aliases.
export function headerIndex(header: string[]): (names: string[]) => number {
  const lower = header.map((h) => h.toLowerCase().trim());
  return (names: string[]) => {
    for (const name of names) {
      const pos = lower.indexOf(name.toLowerCase());
      if (pos >= 0) return pos;
    }
    return -1;
  };
}
