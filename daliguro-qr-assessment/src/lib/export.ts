// CSV building + file download helpers (Phase 9).

// Quote a CSV field when it contains a comma, quote, or newline.
function csvField(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers.map(csvField).join(",")];
  rows.forEach((row) => {
    lines.push(row.map(csvField).join(","));
  });
  return lines.join("\n");
}

export function downloadCsv(text: string, filename: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function safeFilename(name: string): string {
  return name.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "export";
}
