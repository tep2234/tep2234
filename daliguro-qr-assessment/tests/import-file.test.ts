import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { extractImportFile } from "../src/lib/import-file";
import { importTest } from "../src/lib/test-import";

const encoder = new TextEncoder();

function u16(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

function u32(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
}

function zipStore(files: Record<string, string>): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  let offset = 0;

  Object.entries(files).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const localOffset = offset;
    const localHeader = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0),
      ...nameBytes,
    ];
    local.push(...localHeader, ...data);
    offset += localHeader.length + data.length;

    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(localOffset), ...nameBytes,
    );
  });

  const eocd = [
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(Object.keys(files).length),
    ...u16(Object.keys(files).length), ...u32(central.length), ...u32(local.length), ...u16(0),
  ];
  return new Uint8Array([...local, ...central, ...eocd]);
}

describe("extractImportFile", () => {
  it("extracts an XLSX first worksheet into CSV import text", async () => {
    const sheet = [
      '<worksheet><sheetData>',
      '<row r="1"><c r="A1" t="inlineStr"><is><t>Item No.</t></is></c><c r="B1" t="inlineStr"><is><t>Question</t></is></c><c r="C1" t="inlineStr"><is><t>Choice A</t></is></c><c r="D1" t="inlineStr"><is><t>Choice B</t></is></c><c r="E1" t="inlineStr"><is><t>Correct Answer</t></is></c></row>',
      '<row r="2"><c r="A2"><v>1</v></c><c r="B2" t="inlineStr"><is><t>Best letter?</t></is></c><c r="C2" t="inlineStr"><is><t>Alpha</t></is></c><c r="D2" t="inlineStr"><is><t>Beta</t></is></c><c r="E2" t="inlineStr"><is><t>A</t></is></c></row>',
      '</sheetData></worksheet>',
    ].join("");
    const bytes = zipStore({ "xl/worksheets/sheet1.xml": sheet });
    const file = new File([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], "items.xlsx");
    const extracted = await extractImportFile(file);
    const summary = importTest(extracted.text, { versions: ["A"] });

    expect(extracted.text).toContain("Item No.,Question,Choice A,Choice B,Correct Answer");
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].question).toBe("Best letter?");
    expect(summary.rows[0].answers.A).toBe("A");
  });

  it("extracts DOCX paragraph text for structured paste import", async () => {
    const doc = [
      '<w:document><w:body>',
      '<w:p><w:r><w:t>1. The earth is round.</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>Answer: True</w:t></w:r></w:p>',
      '</w:body></w:document>',
    ].join("");
    const bytes = zipStore({ "word/document.xml": doc });
    const file = new File([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], "quiz.docx");
    const extracted = await extractImportFile(file);
    const summary = importTest(extracted.text, { versions: ["A"] });

    expect(extracted.text).toContain("1. The earth is round.");
    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].type).toBe("True or False");
    expect(summary.rows[0].answers.A).toBe("T");
  });

  it("rejects legacy .xls with a Save As .xlsx hint", async () => {
    const file = new File(["legacy-binary"], "grades.xls");
    await expect(extractImportFile(file)).rejects.toThrow(/\.xlsx/i);
  });

  it("rejects legacy .doc with a Save as .docx hint", async () => {
    const file = new File(["legacy-binary"], "quiz.doc");
    await expect(extractImportFile(file)).rejects.toThrow(/\.docx/i);
  });

  it("reports 'no readable questions' for an empty worksheet", async () => {
    const sheet = "<worksheet><sheetData></sheetData></worksheet>";
    const bytes = zipStore({ "xl/worksheets/sheet1.xml": sheet });
    const file = new File([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], "empty.xlsx");
    await expect(extractImportFile(file)).rejects.toThrow(/no readable questions/i);
  });

  it("extracts compressed Office ZIP entries like real XLSX/DOCX files", async () => {
    const sheet = [
      '<worksheet><sheetData>',
      '<row><c r="A1" t="inlineStr"><is><t>Question</t></is></c><c r="B1" t="inlineStr"><is><t>Choice A</t></is></c><c r="C1" t="inlineStr"><is><t>Choice B</t></is></c><c r="D1" t="inlineStr"><is><t>Correct Answer</t></is></c></row>',
      '<row><c r="A2" t="inlineStr"><is><t>Compressed file works?</t></is></c><c r="B2" t="inlineStr"><is><t>Yes</t></is></c><c r="C2" t="inlineStr"><is><t>No</t></is></c><c r="D2" t="inlineStr"><is><t>A</t></is></c></row>',
      '</sheetData></worksheet>',
    ].join("");
    const zipped = zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheet) });
    const file = new File([zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer], "realistic.xlsx");
    const extracted = await extractImportFile(file);
    const summary = importTest(extracted.text, { versions: ["A"] });

    expect(summary.rows[0].question).toBe("Compressed file works?");
    expect(summary.rows[0].answers.A).toBe("A");
  });
});
