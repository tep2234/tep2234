// Analysis Dashboard — read-only over saved results. SmartScan edition:
// summary cards, mastery + score charts, item analysis with discrimination
// index and item-quality flags, competency mastery, and the Smart Teacher
// Summary. Remediation grouping lives in its own tab.

import type { PanelProps } from "./panel-types";
import type {
  Assessment,
  Item,
  QrAssessmentState,
  Result,
} from "../lib/types";
import { downloadCsv, safeFilename, toCsv } from "../lib/export";
import {
  analyzeItems,
  blankHeavy,
  commonWrongAnswers,
  competencyMastery,
  componentSummary,
  leastMissed,
  masteryDistribution,
  mostMissed,
} from "../lib/analysis";
import {
  buildSmartSummary,
  classStats,
  discriminationIndex,
  itemQualityFlags,
} from "../lib/insights";
import { ActiveGate } from "./ActiveGate";
import { CopyCard, MasteryBars, ScoreHistogram } from "./AnalysisWidgets";
import {
  CommonWrong,
  CompetencyTable,
  ComponentTable,
  ItemAnalysisTable,
  MiniList,
  SectionTitle,
} from "./AnalysisTables";
import { Empty } from "./ui";

export default function AnalysisPanel(props: PanelProps) {
  const { state, activeId, setActiveId } = props;
  return (
    <ActiveGate
      assessments={state.assessments}
      activeId={activeId}
      setActiveId={setActiveId}
      title="Analysis Dashboard"
    >
      {(active) => <AnalysisView active={active} state={state} />}
    </ActiveGate>
  );
}

function AnalysisView({
  active,
  state,
}: {
  active: Assessment;
  state: QrAssessmentState;
}) {
  const items: Item[] = state.items.filter((i) => i.assessmentId === active.id);
  const results: Result[] = state.results.filter(
    (r) => r.assessmentId === active.id,
  );

  if (items.length === 0) {
    return (
      <Wrap title="Analysis Dashboard" subtitle={active.title}>
        <Empty text="This assessment has no items yet." />
      </Wrap>
    );
  }
  if (results.length === 0) {
    return (
      <Wrap title="Analysis Dashboard" subtitle={active.title}>
        <Empty text="No checked results yet. Scan or check answer sheets first." />
      </Wrap>
    );
  }

  const itemRows = analyzeItems(items, results);
  const wrong = commonWrongAnswers(items, results);
  const compRows = competencyMastery(items, results);
  const components = componentSummary(state.assessments, state.results);
  const dist = masteryDistribution(results);
  const stats = classStats(results);

  const discByItem = new Map(
    items.map((i) => [i.id, discriminationIndex(i.id, results)]),
  );
  const flagsByItem = new Map(
    itemRows.map((r) => [
      r.item.id,
      itemQualityFlags(r, discByItem.get(r.item.id) ?? null, wrong.get(r.item.id)),
    ]),
  );
  const flagged = itemRows.filter((r) => (flagsByItem.get(r.item.id) ?? []).length > 0);

  const attempted = itemRows.filter((r) => r.attempts > 0);
  const mostMissedRow = attempted.length > 0 ? mostMissed(attempted, 1)[0] : null;
  const weakestComp = compRows[0] ?? null;

  const summaryText = buildSmartSummary({
    assessment: active,
    results,
    learners: state.learners,
    itemRows,
    competencyRows: compRows,
  });

  const fileBase = safeFilename(active.title);

  function exportItems() {
    const headers = [
      "No",
      "Type",
      "Competency",
      "Topic",
      "CognitiveLevel",
      "Points",
      "Correct",
      "Incorrect",
      "Blank",
      "PercentCorrect",
      "Difficulty",
      "Discrimination",
      "QualityFlags",
    ];
    const data = itemRows.map((r) => [
      r.item.itemNumber,
      r.item.type,
      r.competency,
      r.item.topic,
      r.item.cognitiveLevel,
      r.item.points,
      r.correct,
      r.incorrect,
      r.blank,
      r.percentCorrect,
      r.difficulty,
      discByItem.get(r.item.id) ?? "",
      (flagsByItem.get(r.item.id) ?? []).join(" | "),
    ]);
    downloadCsv(toCsv(headers, data), fileBase + "_item_analysis.csv");
  }

  function exportCompetency() {
    const headers = [
      "Competency",
      "LearnersChecked",
      "PossiblePoints",
      "EarnedPoints",
      "MasteryPercent",
      "MasteryLabel",
      "NeedsReteaching",
    ];
    const data = compRows.map((c) => [
      c.competency,
      c.learnersChecked,
      c.possiblePoints,
      c.earnedPoints,
      c.masteryPercent,
      c.masteryLabel,
      c.needsReteaching ? "YES" : "no",
    ]);
    downloadCsv(toCsv(headers, data), fileBase + "_competency_mastery.csv");
  }

  function exportComponents() {
    const headers = ["Component", "Attempts", "Average", "Highest", "Lowest"];
    const data = components.map((c) => [
      c.component,
      c.attempts,
      c.average,
      c.highest,
      c.lowest,
    ]);
    downloadCsv(toCsv(headers, data), fileBase + "_component_summary.csv");
  }

  return (
    <section>
      <h1 className="text-2xl font-extrabold">Analysis — {active.title}</h1>
      <p className="mt-1 text-slate-500">
        {active.subject} · {results.length} checked learner(s)
      </p>

      {/* Summary cards */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Checked" value={String(stats.count)} />
        <Stat label="Class Avg" value={stats.average + "%"} />
        <Stat label="Passing rate" value={stats.passingRate + "%"} />
        <Stat label="High / Low" value={stats.highest + " / " + stats.lowest} />
        <Stat
          label="Most missed"
          value={mostMissedRow ? "#" + mostMissedRow.item.itemNumber : "—"}
        />
        <Stat
          label="Weakest skill"
          value={weakestComp ? weakestComp.masteryPercent + "%" : "—"}
          hint={weakestComp?.competency}
        />
      </div>

      {/* Charts */}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <MasteryBars dist={dist} total={results.length} />
        <ScoreHistogram results={results} />
      </div>

      {/* Smart Teacher Summary */}
      <SectionTitle title="Smart Teacher Summary" />
      <CopyCard title="Ready for DLL reflection / reports" text={summaryText} />

      {/* Item analysis */}
      <SectionTitle title="Item Analysis" onExport={exportItems} />
      <ItemAnalysisTable rows={itemRows} discByItem={discByItem} flagsByItem={flagsByItem} />

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <MiniList
          title="Most missed"
          rows={mostMissed(itemRows, 5)}
          render={(r) => "#" + r.item.itemNumber + " — " + r.percentCorrect + "%"}
        />
        <MiniList
          title="Least missed"
          rows={leastMissed(itemRows, 5)}
          render={(r) => "#" + r.item.itemNumber + " — " + r.percentCorrect + "%"}
        />
        <MiniList
          title="Blank-heavy"
          rows={blankHeavy(itemRows, 5)}
          render={(r) => "#" + r.item.itemNumber + " — " + r.blank + " blank"}
        />
      </div>

      {/* Item quality review */}
      <SectionTitle title="Item Quality Review" />
      {flagged.length === 0 ? (
        <Empty text="No item quality issues detected (or not enough attempts yet)." />
      ) : (
        <div className="mt-2 grid gap-2">
          {flagged.map((r) => (
            <div
              key={r.item.id}
              className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"
            >
              <div className="font-extrabold text-amber-900">
                ⚠ Item {r.item.itemNumber} may need review ({r.percentCorrect}% correct
                {discByItem.get(r.item.id) !== null
                  ? `, discrimination ${discByItem.get(r.item.id)}`
                  : ""}
                )
              </div>
              <ul className="mt-1 list-disc pl-5 text-xs text-amber-900">
                {(flagsByItem.get(r.item.id) ?? []).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Common wrong answers */}
      <SectionTitle title="Common Wrong Answers" />
      <CommonWrong items={items} wrong={wrong} dist={itemRows} />

      {/* Competency mastery */}
      <SectionTitle title="Competency Mastery" onExport={exportCompetency} />
      <CompetencyTable rows={compRows} />

      {/* Component summary */}
      <SectionTitle title="DepEd Component Summary" onExport={exportComponents} />
      <ComponentTable rows={components} />
      <p className="mt-2 text-xs italic text-slate-500">
        Final grade transmutation will be added after official table integration.
      </p>
    </section>
  );
}

// ---- Subcomponents -----------------------------------------

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
      <div className="text-xl font-extrabold text-indigo-700">{value}</div>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      {hint ? (
        <div className="mt-0.5 truncate text-[10px] text-slate-400" title={hint}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function Wrap({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h1 className="text-2xl font-extrabold">{title}</h1>
      <p className="mt-1 text-slate-500">{subtitle}</p>
      {children}
    </section>
  );
}
