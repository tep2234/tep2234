// Smart Item Analysis Report — the professional, print-ready DepEd-style
// assessment report. Header + signature lines, summary cards, mastery and
// error-frequency graphs (grayscale-safe: labels + counts, never color alone),
// item analysis table, competency analysis, learner remediation, item quality
// review, and a copyable Smart Teacher Summary. All math lives in lib/report.

import { useMemo, useState } from "react";
import type { Assessment, Item, Learner, Result } from "../lib/types";
import { buildSmartSummary, classStats } from "../lib/insights";
import { downloadCsv, safeFilename, toCsv } from "../lib/export";
import {
  DEPED_COLOR,
  DEPED_MASTERY_ORDER,
  DEPED_TINT,
  ERROR_BAND_ORDER,
  emptyReportMeta,
  mpsInterpretation,
  MPS_TARGET,
  reportCompetencies,
  reportItems,
  reportLearners,
  reportSummary,
  type ReportMeta,
} from "../lib/report";
import { analyzeItems, competencyMastery } from "../lib/analysis";
import { Button } from "./ui";

const META_KEY = "daliguro_report_meta_";

function loadMeta(a: Assessment): ReportMeta {
  try {
    const raw = localStorage.getItem(META_KEY + a.id);
    if (raw) return { ...emptyReportMeta(a), ...(JSON.parse(raw) as Partial<ReportMeta>) };
  } catch {
    /* ignore */
  }
  return emptyReportMeta(a);
}

export function SmartReport({
  active,
  items,
  results,
  learners,
}: {
  active: Assessment;
  items: Item[];
  results: Result[];
  learners: Learner[];
}) {
  const [meta, setMeta] = useState<ReportMeta>(() => loadMeta(active));
  const [showForm, setShowForm] = useState(false);

  // Total learners for the assessment = enrolled in its section (fallback: all).
  const sectionLearners = learners.filter((l) => l.section === active.section);
  const totalLearners = sectionLearners.length || learners.length;

  const summary = useMemo(() => reportSummary(items, results, totalLearners), [items, results, totalLearners]);
  const itemRows = useMemo(() => reportItems(items, results), [items, results]);
  const compRows = useMemo(() => reportCompetencies(items, results), [items, results]);
  const learnerRows = useMemo(() => reportLearners(items, results, learners), [items, results, learners]);
  const flagged = itemRows.filter((r) => r.qualityFlags.length > 0);
  const summaryText = useMemo(
    () =>
      buildSmartSummary({
        assessment: active,
        results,
        learners,
        itemRows: analyzeItems(items, results),
        competencyRows: competencyMastery(items, results),
      }),
    [active, items, results, learners],
  );

  function patch(p: Partial<ReportMeta>) {
    setMeta((m) => {
      const next = { ...m, ...p };
      try { localStorage.setItem(META_KEY + active.id, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function exportItemCsv() {
    const headers = [
      "Competency", "ItemNo", "Correct", "Error", "PercentCorrect",
      "FreqOfError", "Mastery", "Difficulty", "MostWrong", "ErrorRemark", "RecommendedAction",
    ];
    const data = itemRows.map((r) => [
      r.competency, r.itemNumber, r.correct, r.errors, r.percentCorrect,
      r.freqOfError, r.mastery, r.difficulty, r.mostWrong, r.errorRemark, r.recommendedAction,
    ]);
    downloadCsv(toCsv(headers, data), safeFilename(active.title) + "_item_analysis_report.csv");
  }

  const stats = classStats(results);
  const mps = summary.average; // Mean Percentage Score (DepEd)
  const mastered = summary.masteryCounts.Mastered;
  const masteredPct = summary.takers > 0 ? Math.round((mastered / summary.takers) * 100) : 0;
  // Roster, best → worst, so mastered learners lead (highlighted).
  const roster = useMemo(() => [...learnerRows].sort((a, b) => b.percentage - a.percentage), [learnerRows]);

  // One Excel-ready CSV: MPS summary + color-coded roster + item analysis,
  // stacked as labeled sections. Excel opens .csv directly.
  function exportExcel() {
    const sections = [
      toCsv(["DALIguro — Item Analysis & Mastery Report"], []),
      toCsv(["Assessment", active.title], []),
      toCsv(["Subject", active.subject], []),
      toCsv(["Grade & Section", active.gradeLevel + " - " + active.section], []),
      toCsv(["Summary Metric", "Value"], [
        ["MPS (Mean Percentage Score)", mps + "%"],
        ["Interpretation", mpsInterpretation(mps)],
        ["DepEd Mastery Target", MPS_TARGET + "%"],
        ["Passing Rate", summary.passingRate + "%"],
        ["Highest / Lowest", stats.highest + "% / " + stats.lowest + "%"],
        ["No. of Items", String(summary.numItems)],
        ["Learners / Takers", summary.totalLearners + " / " + summary.takers],
        ["Mastered", `${mastered} (${masteredPct}%)`],
        ["Nearly Mastered", String(summary.masteryCounts["Nearly Mastered"])],
        ["Least Mastered", String(summary.masteryCounts["Least Mastered"])],
        ["Not Mastered", String(summary.masteryCounts["Not Mastered"])],
      ]),
      toCsv(
        ["Rank", "Learner", "LRN", "Score", "Percent", "Mastery", "Weak Competencies", "Missed Items"],
        roster.map((l, i) => [i + 1, l.name, l.lrn, l.score, l.percentage + "%", l.mastery, l.weakCompetencies.join("; ") || "—", l.missedItems.join(" ") || "—"]),
      ),
      toCsv(
        ["ItemNo", "Competency", "Correct", "Error", "PercentCorrect", "FreqOfError", "Mastery", "Difficulty", "MostWrong", "RecommendedAction"],
        itemRows.map((r) => [r.itemNumber, r.competency, r.correct, r.errors, r.percentCorrect + "%", r.freqOfError + "%", r.mastery, r.difficulty, r.mostWrong || "—", r.recommendedAction]),
      ),
    ];
    downloadCsv(sections.join("\n"), safeFilename(active.title) + "_mastery_report.csv");
  }

  return (
    <section>
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-extrabold">Smart Item Analysis Report</h2>
          <p className="text-xs text-slate-500">
            Professional, print-ready report. Fill the header once (saved on this device), then print or export.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Hide" : "Edit"} report header
          </Button>
          <Button variant="ghost" onClick={exportExcel}>⬇ Excel report</Button>
          <Button variant="ghost" onClick={exportItemCsv}>⬇ Item CSV</Button>
          <Button onClick={() => window.print()}>🖨 Print report</Button>
        </div>
      </div>

      {showForm ? (
        <div className="no-print mt-3 grid grid-cols-1 gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-3">
          {([
            ["schoolName", "School Name"],
            ["department", "Department"],
            ["quarter", "Quarter"],
            ["typeOfTest", "Type of Test"],
            ["dateAdministered", "Date Administered"],
            ["dateChecked", "Date Checked"],
            ["preparedBy", "Prepared by"],
            ["reviewedBy", "Reviewed by"],
            ["approvedBy", "Approved by"],
          ] as [keyof ReportMeta, string][]).map(([k, label]) => (
            <label key={k} className="block">
              <span className="mb-1 block text-xs font-bold text-slate-500">{label}</span>
              <input
                value={meta[k]}
                onChange={(e) => patch({ [k]: e.target.value } as Partial<ReportMeta>)}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>
          ))}
        </div>
      ) : null}

      {/* Printable report */}
      <div className="print-area mt-4 rounded-xl border border-slate-200 bg-white p-5 text-slate-800">
        {/* Header */}
        <div className="text-center">
          {meta.schoolName ? <div className="text-lg font-extrabold">{meta.schoolName}</div> : null}
          {meta.department ? <div className="text-sm">{meta.department}</div> : null}
          <div className="mt-1 text-base font-extrabold text-indigo-800">Item Analysis Report</div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          <Meta label="Teacher" value={meta.preparedBy || active.teacherName} />
          <Meta label="Subject" value={active.subject} />
          <Meta label="Grade & Section" value={active.gradeLevel + " – " + active.section} />
          <Meta label="School Year" value={meta.schoolYear} />
          <Meta label="Quarter" value={meta.quarter} />
          <Meta label="Type of Test" value={meta.typeOfTest} />
          <Meta label="Assessment" value={active.title} />
          <Meta label="No. of Items" value={String(summary.numItems)} />
          <Meta label="No. of Learners" value={String(summary.totalLearners)} />
          <Meta label="No. of Takers" value={String(summary.takers)} />
          <Meta label="Absent" value={String(summary.absent)} />
          <Meta label="Date Administered" value={meta.dateAdministered || "—"} />
        </div>

        {/* MPS hero — the headline DepEd metric */}
        <div
          className="mt-4 rounded-xl border p-3"
          style={{
            borderColor: mps >= MPS_TARGET ? "#16a34a" : "#d97706",
            background: mps >= MPS_TARGET ? "#f0fdf4" : "#fffbeb",
            printColorAdjust: "exact",
            WebkitPrintColorAdjust: "exact",
          }}
        >
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Mean Percentage Score (MPS)</div>
              <div className="text-4xl font-black leading-none" style={{ color: mps >= MPS_TARGET ? "#15803d" : "#b45309" }}>{mps}%</div>
            </div>
            <div className="text-right text-[11px]">
              <div className="font-bold text-slate-700">DepEd target: {MPS_TARGET}%</div>
              <div className="text-slate-600">{mastered}/{summary.takers} mastered · {masteredPct}%</div>
            </div>
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded bg-slate-200" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
            <div className="h-full rounded" style={{ width: Math.min(100, mps) + "%", background: mps >= MPS_TARGET ? "#16a34a" : "#d97706", printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }} />
          </div>
          <div className="mt-1.5 text-[11px] font-semibold text-slate-700">{mpsInterpretation(mps)}</div>
        </div>

        {/* Summary cards */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <Card label="Class Average" value={summary.average + "%"} />
          <Card label="Passing Rate" value={summary.passingRate + "%"} />
          <Card label="Overall Mastery" value={summary.overallMastery + "%"} sub={summary.overallMasteryLabel} />
          <Card label="Highest / Lowest" value={stats.highest + " / " + stats.lowest} />
          <Card label="Most Missed" value={summary.mostMissedItem ? "Item " + summary.mostMissedItem : "—"} />
          <Card label="For Remediation" value={String(summary.forRemediation)} />
        </div>

        {/* Graphs */}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <BarGroup
            title="Mastery distribution"
            rows={DEPED_MASTERY_ORDER.map((m) => ({
              label: m,
              count: summary.masteryCounts[m],
              color: DEPED_COLOR[m],
            }))}
            total={summary.takers}
          />
          <BarGroup
            title="Frequency of errors (per item)"
            rows={ERROR_BAND_ORDER.map((b, i) => ({
              label: b,
              count: summary.errorCounts[b],
              color: ["#16a34a", "#0891b2", "#d97706", "#ea580c", "#dc2626"][i],
            }))}
            total={summary.numItems}
          />
        </div>

        {/* Item analysis table */}
        <SectionH>Item Analysis</SectionH>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-500">
                {["Competency", "Item", "Correct", "Error", "% Correct", "Freq. Error", "Mastery", "Difficulty", "Most Wrong", "Remark", "Recommended Action"].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itemRows.map((r) => (
                <tr
                  key={r.itemNumber}
                  className="border-t border-slate-100 align-top"
                  style={r.mastery === "Not Mastered" || r.mastery === "Least Mastered"
                    ? { background: DEPED_TINT[r.mastery], printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }
                    : undefined}
                >
                  <td className="px-2 py-1">{r.competency}</td>
                  <td className="px-2 py-1 font-bold">{r.itemNumber}</td>
                  <td className="px-2 py-1 text-emerald-700">{r.correct}</td>
                  <td className="px-2 py-1 text-red-700">{r.errors}</td>
                  <td className="px-2 py-1 font-bold">{r.percentCorrect}%</td>
                  <td className="px-2 py-1">{r.freqOfError}%</td>
                  <td className="px-2 py-1" style={{ color: DEPED_COLOR[r.mastery] }}>{r.mastery}</td>
                  <td className="px-2 py-1">{r.difficulty}</td>
                  <td className="px-2 py-1">{r.mostWrong || "—"}</td>
                  <td className="px-2 py-1">{r.errorRemark}</td>
                  <td className="px-2 py-1">{r.recommendedAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Competency analysis */}
        <SectionH>Competency Analysis</SectionH>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-500">
                {["Competency", "Items", "Avg % Correct", "Mastery", "Error Rate", "Affected Learners", "Recommended Action"].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {compRows.map((c) => (
                <tr key={c.competency} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1 font-semibold">{c.competency}</td>
                  <td className="px-2 py-1">{c.items.join(", ")}</td>
                  <td className="px-2 py-1 font-bold">{c.avgPercentCorrect}%</td>
                  <td className="px-2 py-1" style={{ color: DEPED_COLOR[c.mastery] }}>{c.mastery}</td>
                  <td className="px-2 py-1">{c.errorRate}%</td>
                  <td className="px-2 py-1">{c.affectedLearners}</td>
                  <td className="px-2 py-1">{c.recommendedAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Class Mastery Roster — every learner, color-coded by mastery band */}
        <SectionH>Class Mastery Roster</SectionH>
        <div className="mb-2 flex flex-wrap gap-1.5 text-[10px]">
          {DEPED_MASTERY_ORDER.map((m) => (
            <span
              key={m}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-bold"
              style={{ background: DEPED_TINT[m], color: DEPED_COLOR[m], printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
            >
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: DEPED_COLOR[m] }} />
              {m}: {summary.masteryCounts[m]}
            </span>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-500">
                {["#", "Learner", "LRN", "Score", "%", "Mastery"].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roster.map((l, i) => (
                <tr
                  key={l.name + l.lrn}
                  style={{ background: DEPED_TINT[l.mastery], borderLeft: "4px solid " + DEPED_COLOR[l.mastery], printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}
                >
                  <td className="px-2 py-1 font-bold">{i + 1}</td>
                  <td className="px-2 py-1 font-semibold">{l.name}</td>
                  <td className="px-2 py-1">{l.lrn || "—"}</td>
                  <td className="px-2 py-1">{l.score}</td>
                  <td className="px-2 py-1 font-extrabold">{l.percentage}%</td>
                  <td className="px-2 py-1 font-bold" style={{ color: DEPED_COLOR[l.mastery] }}>{l.mastery}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Learner remediation */}
        <SectionH>Learner Remediation List</SectionH>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-slate-50 text-left text-slate-500">
                {["Learner", "Score", "%", "Mastery", "Weak Competency", "Missed Items", "Flag", "Intervention"].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {learnerRows.map((l) => (
                <tr key={l.name + l.score} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1 font-semibold">{l.name}</td>
                  <td className="px-2 py-1">{l.score}</td>
                  <td className="px-2 py-1 font-bold">{l.percentage}%</td>
                  <td className="px-2 py-1" style={{ color: DEPED_COLOR[l.mastery] }}>{l.mastery}</td>
                  <td className="px-2 py-1">{l.weakCompetencies.join(", ") || "—"}</td>
                  <td className="px-2 py-1">{l.missedItems.join(", ") || "—"}</td>
                  <td className="px-2 py-1">{l.attentionFlag}</td>
                  <td className="px-2 py-1">{l.intervention}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Item quality review */}
        {flagged.length > 0 ? (
          <>
            <SectionH>Item Quality Review</SectionH>
            <ul className="grid gap-1 text-xs">
              {flagged.map((r) => (
                <li key={r.itemNumber}>
                  <b>Item {r.itemNumber}</b> ({r.percentCorrect}% correct): {r.qualityFlags.join(" ")}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {/* Smart teacher summary */}
        <SectionH>Smart Teacher Summary</SectionH>
        <p className="whitespace-pre-wrap text-xs leading-relaxed">{summaryText}</p>

        {/* Signature lines */}
        <div className="mt-8 grid grid-cols-1 gap-6 text-xs sm:grid-cols-3">
          <Sign label="Prepared by" name={meta.preparedBy || active.teacherName} />
          <Sign label="Reviewed by" name={meta.reviewedBy} />
          <Sign label="Approved by" name={meta.approvedBy} />
        </div>
      </div>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="font-bold text-slate-500">{label}:</span>{" "}
      <span className="font-semibold">{value || "—"}</span>
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2 text-center">
      <div className="text-lg font-extrabold text-indigo-700">{value}</div>
      <div className="text-[10px] font-semibold text-slate-500">{label}</div>
      {sub ? <div className="text-[10px] font-bold text-slate-600">{sub}</div> : null}
    </div>
  );
}

function BarGroup({
  title,
  rows,
  total,
}: {
  title: string;
  rows: { label: string; count: number; color: string }[];
  total: number;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="text-sm font-bold">{title}</div>
      <div className="mt-2 grid gap-1.5">
        {rows.map((r) => {
          const pct = total > 0 ? Math.round((r.count / total) * 100) : 0;
          return (
            <div key={r.label} className="flex items-center gap-2" title={`${r.label}: ${r.count} (${pct}%)`}>
              <span className="w-28 shrink-0 text-[11px] font-semibold text-slate-700">{r.label}</span>
              <div className="h-3.5 flex-1 overflow-hidden rounded bg-slate-100">
                <div className="h-full rounded" style={{ width: pct + "%", minWidth: r.count > 0 ? "4px" : "0", background: r.color }} />
              </div>
              <span className="w-14 shrink-0 text-right text-[11px] font-bold">{r.count} · {pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionH({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-5 border-b border-slate-200 pb-1 text-sm font-extrabold text-indigo-800">{children}</h3>;
}

function Sign({ label, name }: { label: string; name: string }) {
  return (
    <div className="text-center">
      <div className="mt-6 border-t border-slate-400" />
      <div className="mt-1 font-bold">{name || " "}</div>
      <div className="text-slate-500">{label}</div>
    </div>
  );
}
