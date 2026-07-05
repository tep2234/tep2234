// Reports tab — one-click, teacher-ready outputs from the active assessment:
// class summary + reflection (copyable), printable learner result report,
// item/competency/remediation CSVs, and the gradebook-ready CSV (finalized
// results only). PDF = browser print; Excel opens the CSVs directly.

import type { PanelProps } from "./panel-types";
import type {
  Assessment,
  Item,
  Learner,
  QrAssessmentState,
  Result,
} from "../lib/types";
import { masteryColor } from "../lib/scoring";
import {
  analyzeItems,
  commonWrongAnswers,
  competencyMastery,
  remediationGroups,
} from "../lib/analysis";
import {
  buildReflection,
  buildSmartSummary,
  classStats,
  discriminationIndex,
  itemQualityFlags,
} from "../lib/insights";
import { downloadCsv, safeFilename, toCsv } from "../lib/export";
import { ActiveGate } from "./ActiveGate";
import { CopyCard } from "./AnalysisWidgets";
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

// Competencies where a learner earned under 75% of the possible points.
function weakCompetenciesOf(result: Result, itemsById: Map<string, Item>): string[] {
  const groups = new Map<string, { possible: number; earned: number }>();
  result.itemScores.forEach((s) => {
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
    if (g.possible > 0 && (g.earned / g.possible) * 100 < 75) weak.push(comp);
  });
  return weak;
}

function ReportsView({
  active,
  state,
}: {
  active: Assessment;
  state: QrAssessmentState;
}) {
  const items = state.items.filter((i) => i.assessmentId === active.id);
  const results = state.results.filter((r) => r.assessmentId === active.id);
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const learnersById = new Map(state.learners.map((l) => [l.id, l]));
  const fileBase = safeFilename(active.title);

  if (results.length === 0) {
    return (
      <section>
        <h1 className="text-2xl font-extrabold">Reports</h1>
        <Empty text="No checked results yet. Scan or check answer sheets first, then come back for reports." />
      </section>
    );
  }

  const itemRows = analyzeItems(items, results);
  const compRows = competencyMastery(items, results);
  const wrong = commonWrongAnswers(items, results);
  const stats = classStats(results);
  const finalized = results.filter((r) => r.reviewStatus === "finalized");
  const summaryInput = {
    assessment: active,
    results,
    learners: state.learners,
    itemRows,
    competencyRows: compRows,
  };

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
      "CorrectItems",
      "WrongItems",
      "BlankItems",
      "WeakCompetencies",
      "Status",
    ];
    const data = results.map((r) => {
      const l = learnerOf(r);
      const nums = (pred: (s: Result["itemScores"][number]) => boolean) =>
        r.itemScores.filter(pred).map((s) => s.itemNumber).join(" ");
      return [
        l?.lrn ?? "",
        l?.fullName ?? "(unknown)",
        l?.section ?? "",
        r.version,
        r.rawScore,
        r.totalScore,
        r.percentage,
        r.masteryStatus,
        nums((s) => !s.manual && s.correct),
        nums((s) => !s.manual && !s.correct && !s.blank),
        nums((s) => !s.manual && s.blank),
        weakCompetenciesOf(r, itemsById).join("; "),
        r.reviewStatus,
      ];
    });
    downloadCsv(toCsv(headers, data), fileBase + "_learner_results.csv");
  }

  function exportItemCsv() {
    const headers = [
      "No",
      "Competency",
      "PercentCorrect",
      "Difficulty",
      "Discrimination",
      "MostWrongAnswer",
      "QualityFlags",
    ];
    const data = itemRows.map((r) => {
      const disc = discriminationIndex(r.item.id, results);
      const flags = itemQualityFlags(r, disc, wrong.get(r.item.id));
      return [
        r.item.itemNumber,
        r.competency,
        r.percentCorrect,
        r.difficulty,
        disc ?? "",
        wrong.get(r.item.id)?.[0]?.response ?? "",
        flags.join(" | "),
      ];
    });
    downloadCsv(toCsv(headers, data), fileBase + "_item_analysis.csv");
  }

  function exportCompetencyCsv() {
    const headers = ["Competency", "MasteryPercent", "MasteryLabel", "NeedsReteaching"];
    const data = compRows.map((c) => [
      c.competency,
      c.masteryPercent,
      c.masteryLabel,
      c.needsReteaching ? "YES" : "no",
    ]);
    downloadCsv(toCsv(headers, data), fileBase + "_competency_mastery.csv");
  }

  function exportRemediationCsv() {
    const groups = remediationGroups(items, results, state.learners);
    const headers = ["Group", "Learner", "Percentage", "WeakCompetencies", "SuggestedAction"];
    const data: (string | number)[][] = [];
    groups.forEach((g) => {
      g.learners.forEach((l) => {
        data.push([g.status, l.name, l.percentage, l.weakCompetencies.join("; "), l.action]);
      });
    });
    downloadCsv(toCsv(headers, data), fileBase + "_remediation.csv");
  }

  function exportGradebookCsv() {
    if (finalized.length === 0) {
      window.alert(
        "No finalized results yet. Finalize scores in the Results tab first — only locked scores go to the gradebook.",
      );
      return;
    }
    const headers = [
      "LRN",
      "Name",
      "Section",
      "Subject",
      "Component",
      "Term",
      "Assessment",
      "Version",
      "Raw",
      "Total",
      "Percent",
      "FinalizedAt",
    ];
    const data = finalized.map((r) => {
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
    downloadCsv(toCsv(headers, data), fileBase + "_gradebook.csv");
  }

  const sorted = [...results].sort((a, b) => {
    const an = learnerOf(a)?.fullName ?? "";
    const bn = learnerOf(b)?.fullName ?? "";
    return an.localeCompare(bn);
  });

  return (
    <section>
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">Reports — {active.title}</h1>
          <p className="mt-1 text-slate-500">
            {stats.count} checked · {finalized.length} finalized · one-click exports below
          </p>
        </div>
        <Button onClick={() => window.print()}>🖨 Print learner report</Button>
      </div>

      {/* Export buttons */}
      <div className="no-print mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <ExportCard
          title="Learner Result Report"
          desc="Per-learner scores, correct/wrong/blank items, weak skills."
          onClick={exportLearnerCsv}
        />
        <ExportCard
          title="Item Analysis Report"
          desc="Difficulty, discrimination, most-picked wrong answers, quality flags."
          onClick={exportItemCsv}
        />
        <ExportCard
          title="Competency Mastery Report"
          desc="Mastery percent per competency with reteach flags."
          onClick={exportCompetencyCsv}
        />
        <ExportCard
          title="Remediation Report"
          desc="Learners grouped by support level with suggested activities."
          onClick={exportRemediationCsv}
        />
        <ExportCard
          title={`Gradebook Sync (${finalized.length} finalized)`}
          desc="ONLY finalized (locked) scores — ready for the class record."
          onClick={exportGradebookCsv}
          highlight
        />
      </div>

      {results.length - finalized.length > 0 ? (
        <div className="no-print mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
          ⚠ {results.length - finalized.length} result(s) are not finalized yet and will NOT
          appear in the gradebook export. Finalize them in the Results tab.
        </div>
      ) : null}

      {/* Copyable narratives */}
      <div className="no-print">
        <h2 className="mt-6 text-lg font-extrabold">Class Assessment Summary</h2>
        <CopyCard title="Smart Teacher Summary" text={buildSmartSummary(summaryInput)} />
        <h2 className="mt-6 text-lg font-extrabold">Teacher Reflection</h2>
        <CopyCard
          title="For DLL reflection / intervention documentation"
          text={buildReflection(summaryInput)}
        />
      </div>

      {/* Printable learner result report */}
      <div className="print-area mt-6">
        <h2 className="text-lg font-extrabold">
          Learner Result Report — {active.title}
        </h2>
        <p className="text-xs text-slate-500">
          {active.subject} · {active.component} · Class average {stats.average}% · Passing rate{" "}
          {stats.passingRate}%
        </p>
        <div className="mt-3 grid gap-2">
          {sorted.map((r) => {
            const l = learnerOf(r);
            const weak = weakCompetenciesOf(r, itemsById);
            const nums = (pred: (s: Result["itemScores"][number]) => boolean) =>
              r.itemScores.filter(pred).map((s) => s.itemNumber).join(", ");
            return (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-extrabold">{l?.fullName ?? "(unknown learner)"}</span>{" "}
                    <span className="text-xs text-slate-500">
                      LRN {l?.lrn || "—"} · Version {r.version}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-extrabold text-indigo-700">
                      {r.rawScore}/{r.totalScore}
                    </span>{" "}
                    <span className="text-sm font-bold" style={{ color: masteryColor(r.masteryStatus) }}>
                      {r.percentage}% · {r.masteryStatus}
                    </span>
                  </div>
                </div>
                <div className="mt-1 grid gap-0.5 text-xs text-slate-600 sm:grid-cols-3">
                  <div>✓ Correct: {nums((s) => !s.manual && s.correct) || "—"}</div>
                  <div>✗ Wrong: {nums((s) => !s.manual && !s.correct && !s.blank) || "—"}</div>
                  <div>␣ Blank: {nums((s) => !s.manual && s.blank) || "—"}</div>
                </div>
                {weak.length > 0 ? (
                  <div className="mt-1 text-xs text-red-600">Weak skill(s): {weak.join(", ")}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function ExportCard({
  title,
  desc,
  onClick,
  highlight,
}: {
  title: string;
  desc: string;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "flex flex-col gap-1 rounded-xl border p-3 " +
        (highlight ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white")
      }
    >
      <div className="text-sm font-extrabold">{title}</div>
      <p className="flex-1 text-xs text-slate-500">{desc}</p>
      <div>
        <Button variant="small" onClick={onClick}>
          ⬇ Download CSV
        </Button>
      </div>
    </div>
  );
}
