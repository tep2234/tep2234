// Reports and Assessment Intelligence dashboard.
// Uses finalized results when available. If the teacher has checked results that
// are not finalized yet, the dashboard still visualizes them as a clearly marked
// draft so the working analysis data never disappears behind an empty screen.

import { useState, type ReactNode } from "react";
import type { PanelProps } from "./panel-types";
import type { Assessment, Item, Learner, QrAssessmentState, Result } from "../lib/types";
import { analyzeItems, commonWrongAnswers, competencyMastery, remediationGroups } from "../lib/analysis";
import { buildReflection, buildSmartSummary, classStats, discriminationIndex, itemQualityFlags, PASSING_PERCENT } from "../lib/insights";
import { downloadCsv, safeFilename, toCsv } from "../lib/export";
import {
  INTEL_MASTERY_COLOR,
  PERF_COLOR,
  VERIFICATION_COLOR,
  difficultySummary,
  discriminationSummary,
  intelMastery,
  perfLevel,
  reliability,
  scoreDistribution,
  verificationOf,
} from "../lib/report-intel";
import { reportSummary } from "../lib/report";
import { isTrustedResult, trustedResults } from "../lib/result-trust";
import { ActiveGate } from "./ActiveGate";
import { SmartReport } from "./SmartReport";
import { Button, Empty } from "./ui";

export default function ReportsPanel(props: PanelProps) {
  const { state, activeId, setActiveId } = props;
  return (
    <ActiveGate
      assessments={state.assessments}
      activeId={activeId}
      setActiveId={setActiveId}
      title="Reports"
    >
      {(active) => <ReportsView active={active} state={state} />}
    </ActiveGate>
  );
}

function weakCompetenciesOf(result: Result, itemsById: Map<string, Item>): string[] {
  const groups = new Map<string, { possible: number; earned: number }>();
  result.itemScores.forEach((s) => {
    if (s.unresolved) return;
    const item = itemsById.get(s.itemId);
    if (!item) return;
    const comp = item.competency.trim() || "Untagged Competency";
    const g = groups.get(comp) ?? { possible: 0, earned: 0 };
    g.possible += s.points;
    g.earned += s.awarded;
    groups.set(comp, g);
  });
  const weak: string[] = [];
  groups.forEach((g, comp) => {
    if (g.possible > 0 && (g.earned / g.possible) * 100 < PASSING_PERCENT) weak.push(comp);
  });
  return weak;
}

function isReportable(r: Result): boolean {
  return r.reviewStatus === "finalized" || r.finalizedAt != null;
}

function ReportsView({ active, state }: { active: Assessment; state: QrAssessmentState }) {
  const [showFullRoster, setShowFullRoster] = useState(false);
  const items = state.items.filter((i) => i.assessmentId === active.id);
  const allResults = state.results.filter((r) => r.assessmentId === active.id);
  const finalizedResults = allResults.filter((result) => isReportable(result) && isTrustedResult(result));
  const trustedDraftResults = trustedResults(allResults);
  const results = finalizedResults.length > 0 ? finalizedResults : trustedDraftResults;
  const isDraft = finalizedResults.length === 0 && trustedDraftResults.length > 0;
  const pendingResults = allResults.filter((r) => !isReportable(r));
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const learnersById = new Map(state.learners.map((l) => [l.id, l]));
  const sectionLearners = state.learners.filter((l) => l.section === active.section);
  const totalLearners = sectionLearners.length || state.learners.length;
  const fileBase = safeFilename(active.title);

  if (items.length === 0) {
    return (
      <section>
        <DashboardHeader active={active} checked={0} reportable={0} onPrint={() => window.print()} />
        <Empty text="This assessment has no items yet. Add items before generating reports." />
      </section>
    );
  }

  if (allResults.length === 0) {
    return (
      <section>
        <DashboardHeader active={active} checked={0} reportable={0} onPrint={() => window.print()} />
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.2fr_1fr]">
          <Panel title="Class Performance Summary" help="Waiting for checked results">
            <DistributionChart rows={scoreDistribution([])} total={0} />
            <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-sm font-semibold text-slate-500">
              No checked results yet. Scan answer sheets using SmartScan to generate this dashboard.
            </div>
          </Panel>
          <Panel title="Smart Item Analysis Report" help="Preview">
            <EmptyReportPreview active={active} />
          </Panel>
          <Panel title="Mastery Roster" help="No checked learners">
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-semibold text-slate-500">
              Learners will appear here after checking.
            </div>
          </Panel>
        </div>
      </section>
    );
  }

  if (results.length === 0) {
    return (
      <section>
        <DashboardHeader active={active} checked={allResults.length} reportable={0} onPrint={() => window.print()} />
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-900">
          <div className="text-lg font-black">Reports are protected until review is confirmed</div>
          <p className="mt-1 text-sm font-semibold">
            {allResults.length} scan result(s) exist, but all are still in Review or not finalized enough for analysis.
            Confirm the doubtful answers in the Review Queue before generating class performance, item analysis,
            reports, mastery, or remediation data.
          </p>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.2fr_1fr]">
          <Panel title="Class Performance Summary" help="Protected">
            <DistributionChart rows={scoreDistribution([])} total={0} />
          </Panel>
          <Panel title="Smart Item Analysis Report" help="Waiting for trusted results">
            <EmptyReportPreview active={active} />
          </Panel>
          <Panel title="Mastery Roster" help="Review required">
            <div className="rounded-xl border border-dashed border-amber-300 bg-white/70 p-6 text-center text-sm font-semibold text-amber-800">
              Unconfirmed doubtful answers are excluded from reportable data.
            </div>
          </Panel>
        </div>
      </section>
    );
  }

  const itemRows = analyzeItems(items, results);
  const compRows = competencyMastery(items, results);
  const wrong = commonWrongAnswers(items, results);
  const stats = classStats(results);
  const summary = reportSummary(items, results, totalLearners);
  const dist = scoreDistribution(results);
  const rel = reliability(allResults);
  const diff = difficultySummary(items, results);
  const disc = discriminationSummary(items, results);
  const performance = perfLevel(stats.average);
  const fullRoster = [...results]
    .sort((a, b) => b.percentage - a.percentage)
    .map((r) => ({
      result: r,
      learner: learnersById.get(r.learnerId),
      mastery: intelMastery(r.percentage),
      verification: verificationOf(r),
    }));
  const roster = showFullRoster ? fullRoster : fullRoster.slice(0, 8);
  const totalPassing = results.filter((r) => r.percentage >= PASSING_PERCENT).length;
  const remediation = results.filter((r) => r.percentage < PASSING_PERCENT).length;
  const generatedAt = new Date(Math.max(...results.map((r) => r.updatedAt || r.createdAt))).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const topStrengths = itemRows
    .filter((r) => r.percentCorrect >= 80)
    .sort((a, b) => b.percentCorrect - a.percentCorrect)
    .slice(0, 2)
    .map((r) => r.competency || `Item ${r.item.itemNumber}`);
  const weakCompetencies = compRows
    .filter((c) => c.masteryPercent < PASSING_PERCENT)
    .slice(0, 2)
    .map((c) => c.competency);
  const nextActions = [
    weakCompetencies.length > 0
      ? `Focus remediation on ${weakCompetencies[0]}`
      : "Continue enrichment while monitoring borderline learners",
    remediation > 0
      ? `Use differentiated support for ${remediation} learner(s)`
      : "Prepare extension tasks for mastered learners",
  ];
  const summaryInput = { assessment: active, results, learners: state.learners, itemRows, competencyRows: compRows };

  function learnerOf(r: Result): Learner | undefined {
    return learnersById.get(r.learnerId);
  }

  function exportLearnerCsv() {
    const headers = [
      "LRN",
      "Name",
      "Section",
      "Version",
      "Raw",
      "Total",
      "Percent",
      "Mastery",
      "Verification",
      "ScanConfidence",
      "CorrectItems",
      "WrongItems",
      "BlankItems",
      "WeakCompetencies",
    ];
    const data = results.map((r) => {
      const l = learnerOf(r);
      const nums = (pred: (s: Result["itemScores"][number]) => boolean) =>
        r.itemScores.filter((score) => !score.unresolved && pred(score)).map((s) => s.itemNumber).join(" ");
      return [
        l?.lrn ?? "",
        l?.fullName ?? "(unknown)",
        l?.section ?? "",
        r.version,
        r.rawScore,
        r.totalScore,
        r.percentage,
        intelMastery(r.percentage),
        verificationOf(r),
        r.scanConfidence != null ? Math.round(r.scanConfidence * 1000) / 10 + "%" : "",
        nums((s) => !s.manual && s.correct),
        nums((s) => !s.manual && !s.correct && !s.blank),
        nums((s) => !s.manual && s.blank),
        weakCompetenciesOf(r, itemsById).join("; "),
      ];
    });
    downloadCsv(toCsv(headers, data), fileBase + (isDraft ? "_learner_reports_checked_draft.csv" : "_learner_reports_finalized.csv"));
  }

  function exportItemCsv() {
    const headers = ["No", "Competency", "PercentCorrect", "Difficulty", "Discrimination", "MostWrongAnswer", "QualityFlags"];
    const data = itemRows.map((r) => {
      const d = discriminationIndex(r.item.id, results);
      const flags = itemQualityFlags(r, d, wrong.get(r.item.id));
      return [r.item.itemNumber, r.competency, r.percentCorrect, r.difficulty, d ?? "", wrong.get(r.item.id)?.[0]?.response ?? "", flags.join(" | ")];
    });
    downloadCsv(toCsv(headers, data), fileBase + (isDraft ? "_item_analysis_checked_draft.csv" : "_item_analysis_finalized.csv"));
  }

  function exportCompetencyCsv() {
    const headers = ["Competency", "MasteryPercent", "MasteryLabel", "NeedsReteaching"];
    const data = compRows.map((c) => [c.competency, c.masteryPercent, c.masteryLabel, c.needsReteaching ? "YES" : "no"]);
    downloadCsv(toCsv(headers, data), fileBase + (isDraft ? "_competency_mastery_checked_draft.csv" : "_competency_mastery_finalized.csv"));
  }

  function exportRemediationCsv() {
    const groups = remediationGroups(items, results, state.learners);
    const headers = ["Group", "Learner", "Percentage", "WeakCompetencies", "SuggestedAction"];
    const data: (string | number)[][] = [];
    groups.forEach((g) => {
      g.learners.forEach((l) => data.push([g.status, l.name, l.percentage, l.weakCompetencies.join("; "), l.action]));
    });
    downloadCsv(toCsv(headers, data), fileBase + (isDraft ? "_remediation_checked_draft.csv" : "_remediation_finalized.csv"));
  }

  function exportGradebookCsv() {
    if (finalizedResults.length === 0) {
      window.alert("No finalized results yet. The dashboard can preview checked data, but gradebook export requires finalized scores.");
      return;
    }
    const headers = ["LRN", "Name", "Section", "Subject", "Component", "Term", "Assessment", "Version", "Raw", "Total", "Percent", "FinalizedAt"];
    const data = finalizedResults.map((r) => {
      const l = learnerOf(r);
      return [
        l?.lrn ?? "",
        l?.fullName ?? "(unknown)",
        l?.section ?? "",
        active.subject,
        active.component,
        active.term,
        active.title,
        r.version,
        r.rawScore,
        r.totalScore,
        r.percentage,
        r.finalizedAt ? new Date(r.finalizedAt).toISOString() : "",
      ];
    });
    downloadCsv(toCsv(headers, data), fileBase + "_gradebook_finalized.csv");
  }

  return (
    <section className="reports-intel">
      <DashboardHeader active={active} checked={allResults.length} reportable={results.length} onPrint={() => window.print()} />

      {isDraft || pendingResults.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <b>{isDraft ? "Draft dashboard from checked results." : `${pendingResults.length} result(s) need review or finalization.`}</b>{" "}
          {isDraft
            ? "Finalize scores in Results when you are ready for official gradebook and school-record exports."
            : "Official exports use finalized results; pending scans are shown in reliability metrics."}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon="DOC" label="Total Reports Ready" value={String(results.length)} note={isDraft ? `${results.length} checked draft result(s)` : `${Math.round((results.length / allResults.length) * 100)}% of ${allResults.length} checked`} tone="indigo" />
        <KpiCard icon="MPS" label="Mean Percentage Score (MPS)" value={stats.average + "%"} note="Class average" tone="blue" />
        <KpiCard icon="OK" label="Passing Rate" value={stats.passingRate + "%"} note={`${totalPassing} of ${results.length} learners`} tone="green" />
        <KpiCard icon="REM" label="Students for Remediation" value={String(remediation)} note={`${Math.round((remediation / results.length) * 1000) / 10}% of reportable learners`} tone="orange" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <CompactMetric label="Scan Accuracy" value={rel.scanAccuracy ? rel.scanAccuracy + "%" : "Manual"} note="Verified scan confidence" tone="green" />
        <CompactMetric label="Auto-Finalized" value={rel.autoFinalizedPct + "%"} note="Clean scans accepted" tone="indigo" />
        <CompactMetric label="Needs Review" value={String(rel.needsReview)} note="Saved but not reportable yet" tone={rel.needsReview > 0 ? "orange" : "green"} />
        <CompactMetric label="Sync Health" value="Synced" note={`Last update: ${generatedAt}`} tone="blue" />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-4">
        <DataFlowStep title="SmartScan" value={`${rel.scanResults} scan result(s)`} ok={rel.scanResults > 0 || results.length > 0} />
        <DataFlowStep title="Review Queue" value={`${rel.needsReview} pending`} ok={rel.needsReview === 0} warn={rel.needsReview > 0} />
        <DataFlowStep title="Checked Results" value={`${results.length} analyzed`} ok={results.length > 0} />
        <DataFlowStep title="Report Export" value={isDraft ? "Draft preview" : "Official ready"} ok={!isDraft} warn={isDraft} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_1.2fr_1fr]">
        <Panel title="Class Performance Summary" help="Distribution of Mean Percentage Score (MPS)">
          <DistributionChart rows={dist} total={results.length} />
          <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-950">
            Total Reports: {results.length} · Overall MPS: {stats.average}% · Passing Rate: {stats.passingRate}%
          </div>
        </Panel>

        <Panel title="Smart Item Analysis Report" help="Preview">
          <ReportPreview
            active={active}
            generatedAt={generatedAt}
            summary={summary}
            difficulty={diff}
            discrimination={disc}
            teacher={active.teacherName}
          />
        </Panel>

        <Panel title="Mastery Roster" help={isDraft ? "Checked learners" : "Finalized learners"}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] uppercase text-slate-500">
                  <th className="py-2 pr-2">Learner</th>
                  <th className="py-2 pr-2">MPS</th>
                  <th className="py-2 pr-2">Mastery</th>
                  <th className="py-2 pr-2">Confidence</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {roster.map(({ result, learner, mastery, verification }) => (
                  <tr key={result.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-2">
                        <Avatar name={learner?.fullName ?? "Unknown"} />
                        <span className="font-semibold text-slate-800">{learner?.fullName ?? "(unknown)"}</span>
                      </div>
                    </td>
                    <td className="py-2 pr-2 font-extrabold text-indigo-950">{result.percentage}%</td>
                    <td className="py-2 pr-2">
                      <Badge color={INTEL_MASTERY_COLOR[mastery]}>{mastery}</Badge>
                    </td>
                    <td className="py-2 pr-2 text-xs font-black text-slate-600">
                      {result.scanConfidence != null ? Math.round(result.scanConfidence * 100) + "%" : "Manual"}
                    </td>
                    <td className="py-2">
                      <Badge color={VERIFICATION_COLOR[verification]}>{verification}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {fullRoster.length > 8 ? (
            <button
              onClick={() => setShowFullRoster((v) => !v)}
              className="mt-3 text-sm font-black text-indigo-700 hover:text-indigo-900"
            >
              {showFullRoster ? "Show top learners" : "View full mastery roster"} →
            </button>
          ) : null}
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_1fr_1fr]">
        <Panel title="MPS Interpretation" help="Performance level">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <MpsRing value={stats.average} color={PERF_COLOR[performance]} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold uppercase text-slate-500">Performance Level</div>
              <div className="mt-1 text-2xl font-black" style={{ color: PERF_COLOR[performance] }}>{performance}</div>
              <p className="mt-2 text-sm text-slate-600">
                The class performance is {performance.toLowerCase()}. Continue targeted interventions to improve mastery.
              </p>
              <Legend />
            </div>
          </div>
        </Panel>

        <Panel title="Export and Print Options" help={isDraft ? "Preview exports from checked data" : "Finalized data ready"}>
          <div className="grid grid-cols-2 gap-3">
            <ExportTile label="Print Report" sub="Print-ready format" icon="PRN" onClick={() => window.print()} />
            <ExportTile label="Excel Report" sub=".csv spreadsheet" icon="XLS" onClick={exportLearnerCsv} />
            <ExportTile label="PDF Report" sub="Use browser print" icon="PDF" onClick={() => window.print()} />
            <ExportTile label="Word Export" sub="Coming soon" icon="DOC" disabled />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="small" onClick={exportItemCsv}>Item CSV</Button>
            <Button variant="small" onClick={exportCompetencyCsv}>Competency CSV</Button>
            <Button variant="small" onClick={exportRemediationCsv}>Remediation CSV</Button>
            <Button variant="small" onClick={exportGradebookCsv}>Gradebook CSV</Button>
          </div>
        </Panel>

        <Panel title="Report Insights" help="Action-ready notes">
          <InsightBlock tone="green" title="Top Strengths" lines={topStrengths.length ? topStrengths : ["No strong item cluster yet"]} />
          <InsightBlock tone="orange" title="Weak Competencies" lines={weakCompetencies.length ? weakCompetencies : ["No competency below passing threshold"]} />
          <InsightBlock tone="blue" title="Next Actions" lines={nextActions} />
          <InsightBlock
            tone="slate"
            title="Data Reliability Notes"
            lines={[
              `${rel.resultsLost} results lost`,
              `${rel.reviewAdjusted} scans manually reviewed`,
              `${rel.needsReview} pending review`,
              `${rel.scanAccuracy ? rel.scanAccuracy + "% average scan confidence" : "Manual checks included"}`,
            ]}
          />
        </Panel>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-950">
        <span>{isDraft ? "Checked-result preview is ready for teacher review." : "All reports are ready for supervisors, teachers, and school records."} Data is accurate as of {generatedAt}.</span>
        <span>Secure · Confidential · Compliant</span>
      </div>

      <div className="no-print mt-6 grid gap-3 lg:grid-cols-2">
        <Narrative title="Smart Teacher Summary" text={buildSmartSummary(summaryInput)} />
        <Narrative title="Teacher Reflection" text={buildReflection(summaryInput)} />
      </div>

      <div className="mt-6">
        <SmartReport active={active} items={items} results={results} learners={state.learners} />
      </div>
    </section>
  );
}

function DashboardHeader({ active, checked, reportable, onPrint }: { active: Assessment; checked: number; reportable: number; onPrint: () => void }) {
  return (
    <div className="no-print flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h1 className="text-3xl font-black tracking-tight text-slate-950">Reports and Assessment Intelligence</h1>
        <p className="mt-1 text-sm font-semibold text-slate-500">
          Executive Overview · Reports · {active.title}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
          {active.term} Quarter · {active.schoolYear}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
          {active.gradeLevel} - {active.section}
        </div>
        <Button onClick={onPrint}>Export / Print</Button>
      </div>
      <span className="sr-only">{checked} checked results, {reportable} reportable.</span>
    </div>
  );
}

function KpiCard({ icon, label, value, note, tone }: { icon: string; label: string; value: string; note: string; tone: "indigo" | "blue" | "green" | "orange" }) {
  const cls = {
    indigo: "bg-indigo-50 text-indigo-700 ring-indigo-100",
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    orange: "bg-orange-50 text-orange-700 ring-orange-100",
  }[tone];
  const noteCls = {
    indigo: "text-indigo-700",
    blue: "text-blue-700",
    green: "text-emerald-700",
    orange: "text-orange-700",
  }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60">
      <div className="flex items-center gap-4">
        <div className={"flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xs font-black ring-8 " + cls}>{icon}</div>
        <div className="min-w-0">
          <div className="text-sm font-extrabold text-slate-700">{label}</div>
          <div className="mt-1 text-4xl font-black leading-none text-[#06154a]">{value}</div>
          <div className={"mt-1 text-xs font-bold " + noteCls}>{note}</div>
        </div>
      </div>
    </div>
  );
}

function CompactMetric({ label, value, note, tone }: { label: string; value: string; note: string; tone: "indigo" | "blue" | "green" | "orange" }) {
  const border = tone === "green" ? "border-emerald-200" : tone === "orange" ? "border-orange-200" : tone === "blue" ? "border-blue-200" : "border-indigo-200";
  return (
    <div className={"rounded-xl border bg-white px-4 py-3 shadow-sm " + border}>
      <div className="text-xs font-bold uppercase text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-black text-slate-950">{value}</div>
      <div className="text-xs font-semibold text-slate-500">{note}</div>
    </div>
  );
}

function DataFlowStep({ title, value, ok, warn }: { title: string; value: string; ok: boolean; warn?: boolean }) {
  const cls = warn
    ? "border-amber-200 bg-amber-50 text-amber-800"
    : ok
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-slate-200 bg-white text-slate-500";
  return (
    <div className={"rounded-2xl border px-4 py-3 shadow-sm " + cls}>
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-white/80 text-xs font-black">
          {warn ? "!" : ok ? "OK" : "--"}
        </span>
        <div>
          <div className="text-xs font-black uppercase tracking-wide">{title}</div>
          <div className="text-xs font-semibold opacity-80">{value}</div>
        </div>
      </div>
    </div>
  );
}

function Panel({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-black text-slate-950">{title}</h2>
        {help ? <span className="text-xs font-bold text-slate-400">{help}</span> : null}
      </div>
      {children}
    </section>
  );
}

function DistributionChart({ rows, total }: { rows: ReturnType<typeof scoreDistribution>; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="h-64">
      <div className="flex h-52 items-end gap-3 border-b border-l border-slate-200 px-3">
        {rows.map((r) => {
          const pct = total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0;
          return (
            <div key={r.label} className="flex h-full flex-1 flex-col justify-end">
              <div className="mb-1 text-center text-xs font-black text-slate-800">{r.count}</div>
              <div
                className="min-h-1 rounded-t-lg bg-indigo-600"
                style={{ height: `${Math.max(4, (r.count / max) * 86)}%` }}
                title={`${r.label}: ${r.count} (${pct}%)`}
              />
              <div className="mt-2 text-center text-xs font-bold text-slate-500">{r.label}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-center text-xs font-bold text-slate-500">MPS Range (%)</div>
    </div>
  );
}

function ReportPreview({
  active,
  generatedAt,
  summary,
  difficulty,
  discrimination,
  teacher,
}: {
  active: Assessment;
  generatedAt: string;
  summary: ReturnType<typeof reportSummary>;
  difficulty: ReturnType<typeof difficultySummary>;
  discrimination: ReturnType<typeof discriminationSummary>;
  teacher: string;
}) {
  return (
    <div className="rounded-lg border border-slate-300 bg-white p-4 text-[11px] text-slate-900 shadow-inner">
      <div className="text-center">
        <div className="text-sm font-black uppercase">Smart Item Analysis Report</div>
        <div className="font-bold text-slate-500">DALIguro QR Assessment</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-y border-slate-200 py-2">
        <Meta label="School" value="Current School Profile" />
        <Meta label="Teacher" value={teacher} />
        <Meta label="Quarter" value={`${active.term} Quarter`} />
        <Meta label="Grade & Section" value={`${active.gradeLevel} - ${active.section}`} />
        <Meta label="Subject" value={active.subject} />
        <Meta label="Date Generated" value={generatedAt} />
      </div>
      <PreviewTable
        title="Assessment Summary"
        rows={[
          ["Total Items", summary.numItems],
          ["MPS", summary.average + "%"],
          ["Passing Rate", summary.passingRate + "%"],
          ["Highest Score", summary.highest + "%"],
          ["Lowest Score", summary.lowest + "%"],
        ]}
      />
      <PreviewTable
        title="Item Performance Overview"
        rows={[
          ["Easy", difficulty.easy],
          ["Moderate", difficulty.moderate],
          ["Difficult", difficulty.difficult],
          ["High Disc.", discrimination.high],
          ["Low Disc.", discrimination.low],
        ]}
      />
      <div className="mt-5 grid grid-cols-3 gap-4 text-center text-[10px]">
        <SignMini label="Prepared by" name={teacher} />
        <SignMini label="Noted by" name="" />
        <SignMini label="Approved by" name="" />
      </div>
      <div className="mt-3 rounded bg-indigo-50 px-2 py-1 text-center font-bold text-indigo-800">
        This report is ready to print and save for school records.
      </div>
    </div>
  );
}

function EmptyReportPreview({ active }: { active: Assessment }) {
  return (
    <div className="rounded-xl border border-slate-300 bg-white p-4 text-[11px] text-slate-900 shadow-inner">
      <div className="text-center">
        <div className="text-sm font-black uppercase">Smart Item Analysis Report</div>
        <div className="font-bold text-slate-500">DALIguro QR Assessment</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-y border-slate-200 py-2">
        <Meta label="Teacher" value={active.teacherName} />
        <Meta label="Subject" value={active.subject} />
        <Meta label="Grade & Section" value={`${active.gradeLevel} - ${active.section}`} />
        <Meta label="Status" value="Waiting for checked results" />
      </div>
      <div className="mt-3 grid grid-cols-5 overflow-hidden rounded border border-slate-200">
        {["Items", "MPS", "Passing", "Highest", "Lowest"].map((label) => (
          <div key={label} className="border-r border-slate-200 p-2 text-center last:border-r-0">
            <div className="text-[10px] font-bold text-slate-500">{label}</div>
            <div className="mt-1 text-sm font-black">--</div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded bg-slate-50 px-3 py-5 text-center font-bold text-slate-500">
        Scan or check answer sheets to populate this official report preview.
      </div>
    </div>
  );
}

function PreviewTable({ title, rows }: { title: string; rows: [string, string | number][] }) {
  return (
    <div className="mt-3">
      <div className="mb-1 font-black uppercase text-indigo-800">{title}</div>
      <div className="grid grid-cols-5 overflow-hidden rounded border border-slate-200">
        {rows.map(([label, value]) => (
          <div key={label} className="border-r border-slate-200 p-2 text-center last:border-r-0">
            <div className="text-[10px] font-bold text-slate-500">{label}</div>
            <div className="mt-1 text-sm font-black">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div><b className="text-slate-500">{label}:</b> {value || "-"}</div>;
}

function SignMini({ label, name }: { label: string; name: string }) {
  return (
    <div>
      <div className="border-t border-slate-400 pt-1 font-bold">{name || "\u00a0"}</div>
      <div className="text-slate-500">{label}</div>
    </div>
  );
}

function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex rounded-full px-2 py-1 text-[11px] font-black" style={{ background: color + "20", color }}>
      {children}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/[,\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-[11px] font-black text-white">
      {initials}
    </span>
  );
}

function MpsRing({ value, color }: { value: number; color: string }) {
  return (
    <div className="grid h-36 w-36 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(${color} ${value * 3.6}deg, #e5e7eb 0deg)` }}>
      <div className="grid h-24 w-24 place-items-center rounded-full bg-white text-center">
        <div>
          <div className="text-2xl font-black text-slate-950">{value}%</div>
          <div className="text-xs font-bold text-slate-500">MPS</div>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const rows = [
    ["90% and above", "Outstanding", "#16a34a"],
    ["75% to 89%", "Very Satisfactory", "#0891b2"],
    ["50% to 74%", "Satisfactory", "#4f46e5"],
    ["25% to 49%", "Fair", "#d97706"],
    ["Below 25%", "Poor", "#dc2626"],
  ];
  return (
    <div className="mt-3 grid gap-1 text-xs">
      {rows.map(([range, label, color]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          <span className="font-bold text-slate-700">{range}</span>
          <span className="text-slate-500">{label}</span>
        </div>
      ))}
    </div>
  );
}

function ExportTile({ label, sub, icon, onClick, disabled }: { label: string; sub: string; icon: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "rounded-lg border border-slate-200 bg-slate-50 p-3 text-center " +
        (disabled ? "cursor-not-allowed opacity-60" : "hover:border-indigo-300 hover:bg-indigo-50")
      }
    >
      <div className="mx-auto grid h-10 w-10 place-items-center rounded-lg bg-white text-xs font-black text-indigo-700 shadow-sm">{icon}</div>
      <div className="mt-2 text-sm font-black text-slate-900">{label}</div>
      <div className="text-xs font-semibold text-slate-500">{sub}</div>
    </button>
  );
}

function InsightBlock({ title, lines, tone }: { title: string; lines: string[]; tone: "green" | "orange" | "blue" | "slate" }) {
  const color = tone === "green" ? "text-emerald-700 bg-emerald-50" : tone === "orange" ? "text-orange-700 bg-orange-50" : tone === "blue" ? "text-indigo-700 bg-indigo-50" : "text-slate-700 bg-slate-50";
  return (
    <div className={"mb-2 rounded-lg p-3 " + color}>
      <div className="text-sm font-black">{title}</div>
      <ul className="mt-1 grid gap-1 text-xs font-semibold">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </div>
  );
}

function Narrative({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-black text-slate-950">{title}</div>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
    </div>
  );
}
