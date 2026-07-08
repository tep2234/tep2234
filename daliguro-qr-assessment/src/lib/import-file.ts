// Browser-side teacher file extraction for Smart Import.
// Supports CSV/TXT directly, XLSX first worksheet, and DOCX document text.
// All extracted text still goes through lib/test-import validation before save.

import { strFromU8, unzipSync } from "fflate";

export interface ExtractedImportFile {
  text: string;
  notices: string[];
}

function xmlText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}

function colIndex(ref: string): number {
  const letters = ref.replace(/[^A-Za-z]/g, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

async function zipTextMap(buffer: ArrayBuffer): Promise<Map<string, string>> {
  const files = unzipSync(new Uint8Array(buffer));
  const map = new Map<string, string>();
  for (const [name, bytes] of Object.entries(files)) {
    if (
      name === "word/document.xml" ||
      name === "xl/sharedStrings.xml" ||
      /^xl\/worksheets\/sheet\d+\.xml$/.test(name)
    ) {
      map.set(name, strFromU8(bytes));
    }
  }
  return map;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si\b[\s\S]*?<\/si>/g)) {
    const text = [...match[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((m) => xmlText(m[1]))
      .join("");
    strings.push(text);
  }
  return strings;
}

function parseXlsxWorksheet(sheetXml: string, shared: string[]): string {
  const rows: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = /r="([^"]+)"/.exec(attrs)?.[1] ?? "";
      const idx = ref ? colIndex(ref) : row.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "";
      const inline = /<is\b[\s\S]*?<t\b[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/.exec(body)?.[1];
      const value = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
      row[idx] = type === "s" ? shared[Number(value)] ?? "" : inline !== undefined ? xmlText(inline) : xmlText(value);
    }
    if (row.some((cell) => (cell ?? "").trim())) rows.push(row);
  }
  return rows.map((row) => row.map((cell) => csvField(cell ?? "")).join(",")).join("\n");
}

function parseDocxText(documentXml: string): string {
  const paragraphs: string[] = [];
  for (const p of documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const text = [...p[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((m) => xmlText(m[1]))
      .join("");
    if (text.trim()) paragraphs.push(text.trim());
  }
  return paragraphs.join("\n");
}

export async function extractImportFile(file: File): Promise<ExtractedImportFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt") || file.type.startsWith("text/")) {
    return { text: await file.text(), notices: [] };
  }

  if (name.endsWith(".xlsx")) {
    const map = await zipTextMap(await file.arrayBuffer());
    const sheetName = [...map.keys()].find((key) => /^xl\/worksheets\/sheet\d+\.xml$/.test(key));
    if (!sheetName) throw new Error("No worksheet found in this Excel file.");
    const shared = parseSharedStrings(map.get("xl/sharedStrings.xml") ?? "");
    const text = parseXlsxWorksheet(map.get(sheetName) ?? "", shared);
    if (!text.trim()) throw new Error("No readable questions were found in this file.");
    return {
      text,
      notices: ["Excel file imported from the first worksheet. Review every detected row before saving."],
    };
  }

  // Legacy binary Excel — not a zip, so it can't be read client-side here.
  if (name.endsWith(".xls")) {
    throw new Error("Old .xls files aren't supported. In Excel choose File → Save As → .xlsx, then upload again.");
  }

  if (name.endsWith(".docx")) {
    const map = await zipTextMap(await file.arrayBuffer());
    const doc = map.get("word/document.xml");
    if (!doc) throw new Error("No document body found in this Word file.");
    const text = parseDocxText(doc);
    if (!text.trim()) throw new Error("No readable questions were found in this file.");
    return {
      text,
      notices: ["Word file text extracted. Formatting/tables are flattened, so review detected items before saving."],
    };
  }

  // Legacy binary Word — mammoth-style extraction isn't available here.
  if (name.endsWith(".doc")) {
    throw new Error("Old .doc files aren't supported yet. Save the file as .docx and upload again.");
  }

  if (name.endsWith(".pdf")) {
    throw new Error("PDF import is not enabled yet. Use CSV, Excel .xlsx, Word .docx, TXT, or paste the test text.");
  }

  throw new Error("This file type is not supported. Please upload .xlsx, .csv, or .docx.");
}
