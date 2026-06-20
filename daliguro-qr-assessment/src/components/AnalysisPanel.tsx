// Phase 10 — Analysis Dashboard. Read-only over saved results.

import type { PanelProps } from "./panel-types";
import type {
  Assessment,
  Item,
  QrAssessmentState,
  Result,
} from "../lib/types";
import { MASTERY_STATUSES } from "../lib/types";
import { masteryColor } from "../lib/scoring";
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
  remediationGroups,
  type CompetencyRow,
  type ItemAnalysisRow,
  type RemediationGroup,
} from "../lib/analysis";
import { ActiveGate } from "./ActiveGate";
import { Button, Empty } from "./ui";

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
        <Empty text="No checked results yet. Check learner answers first." />
      </Wrap>
    );
  }

  const itemRows = analyzeItems(items, results);
  const wrong = commonWrongAnswers(items, results);
  const compRows = competencyMastery(items, results);
  const remediation = remediationGroups(items, results, state.learners);
  const components = componentSummary(state.assessments, state.results);
  const dist = masteryDistribution(results);

  const percentages = results.map((r) => r.percentage);
  const avg = round1(average(percentages));
  const high = Math.max(...percentages);
  const low = Math.min(...percentages);

  const fileBase = safeFilename(active.title);

  function exportItems() {
    const headers = [
      "No",
      "Type",
      "Competency",
      "Points",
      "Correct",
      "Incorrect",
      "Blank",
      "PercentCorrect",
      "Difficulty",
    ];
    const data = itemRows.map((r) => [
      r.item.itemNumber,
      r.item.type,
      r.competency,
      r.item.points,
      r.correct,
      r.incorrect,
      r.blank,
      r.percentCorrect,
      r.difficulty,
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

  function exportRemediation() {
    const headers = [
      "Group",
      "Learner",
      "Percentage",
      "WeakCompetencies",
      "SuggestedAction",
    ];
    const data: (string | number)[][] = [];
    remediation.forEach((g) => {
      g.learners.forEach((l) => {
        data.push([
          g.status,
          l.name,
          l.percentage,
          l.weakCompetencies.join("; "),
          l.action,
        ]);
      });
    });
    downloadCsv(toCsv(headers, data), fileBase + "_remediation_groups.csv");
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
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Checked" value={String(results.length)} />
        <Stat label="Class Avg" value={avg + "%"} />
        <Stat label="Highest" value={high + "%"} />
        <Stat label="Lowest" value={low + "%"} />
      </div>

      {/* Mastery distribution */}
      <div className="mt-3 flex flex-wrap gap-2">
        {MASTERY_STATUSES.map((m) => (
          <span
            key={m}
            className="rounded-full px-3 py-1 text-xs font-bold text-white"
            style={{ background: masteryColor(m) }}
          >
            {m}: {dist[m]}
          </span>
        ))}
      </div>

      {/* Item analysis */}
      <SectionTitle title="Item Analysis" onExport={exportItems} />
      <ItemAnalysisTable rows={itemRows} />

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

      {/* Common wrong answers */}
      <SectionTitle title="Common Wrong Answers" />
      <CommonWrong items={items} wrong={wrong} dist={itemRows} />

      {/* Competency mastery */}
      <SectionTitle title="Competency Mastery" onExport={exportCompetency} />
      <CompetencyTable rows={compRows} />

      {/* Remediation groups */}
      <SectionTitle title="Remediation Groups" onExport={exportRemediation} />
      <Remediation groups={remediation} />

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

function ItemAnalysisTable({ rows }: { rows: ItemAnalysisRow[] }) {
  const headers = ["No", "Type", "Competency", "Pts", "✓", "✗", "blank", "%", "Difficulty"];
  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-xs text-slate-500">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item.id} className="border-t border-slate-100">
              <td className="px-3 py-2">{r.item.itemNumber}</td>
              <td className="px-3 py-2">{r.item.type}</td>
              <td className="px-3 py-2">{r.competency}</td>
              <td className="px-3 py-2">{r.item.points}</td>
              <td className="px-3 py-2 text-emerald-700">{r.correct}</td>
              <td className="px-3 py-2 text-red-700">{r.incorrect}</td>
              <td className="px-3 py-2 text-amber-700">{r.blank}</td>
              <td className="px-3 py-2 font-bold">{r.percentCorrect}%</td>
              <td className="px-3 py-2">{r.difficulty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CommonWrong({
  items,
  wrong,
  dist,
}: {
  items: Item[];
  wrong: Map<string, { response: string; count: number }[]>;
  dist: ItemAnalysisRow[];
}) {
  const blankByItem = new Map(dist.map((r) => [r.item.id, r.blank]));
  const withWrong = items.filter((i) => wrong.has(i.id) || (blankByItem.get(i.id) ?? 0) > 0);

  if (withWrong.length === 0) {
    return <Empty text="No wrong answers recorded yet." />;
  }
  return (
    <div className="mt-2 grid gap-2">
      {withWrong.map((item) => {
        const list = wrong.get(item.id) ?? [];
        const blanks = blankByItem.get(item.id) ?? 0;
        return (
          <div
            key={item.id}
            className="rounded-xl border border-slate-200 bg-white p-3 text-sm"
          >
            <div className="font-semibold">
              #{item.itemNumber} {item.type}
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              {list.map((w) => (
                <span
                  key={w.response}
                  className="rounded bg-red-50 px-2 py-1 text-xs text-red-700"
                >
                  “{w.response}” ×{w.count}
                </span>
              ))}
              {blanks > 0 ? (
                <span className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
                  blank ×{blanks}
                </span>
              ) : null}
              {list.length === 0 && blanks === 0 ? (
                <span className="text-xs text-slate-400">—</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CompetencyTable({ rows }: { rows: CompetencyRow[] }) {
  const headers = ["Competency", "Earned/Possible", "Mastery", "Label", "Reteach?"];
  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-xs text-slate-500">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.competency} className="border-t border-slate-100">
              <td className="px-3 py-2 font-semibold">{c.competency}</td>
              <td className="px-3 py-2">
                {c.earnedPoints}/{c.possiblePoints}
              </td>
              <td className="px-3 py-2 font-bold">{c.masteryPercent}%</td>
              <td className="px-3 py-2">
                <span
                  className="text-xs font-bold"
                  style={{ color: masteryColor(c.masteryLabel) }}
                >
                  ● {c.masteryLabel}
                </span>
              </td>
              <td className="px-3 py-2">
                {c.needsReteaching ? (
                  <span className="font-bold text-red-600">Reteach</span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Remediation({ groups }: { groups: RemediationGroup[] }) {
  return (
    <div className="mt-2 grid gap-3 md:grid-cols-2">
      {groups.map((g) => (
        <div key={g.status} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <span
              className="text-sm font-extrabold"
              style={{ color: masteryColor(g.status) }}
            >
              ● {g.status} ({g.learners.length})
            </span>
          </div>
          <div className="text-xs text-slate-500">Action: {g.action}</div>
          {g.learners.length === 0 ? (
            <div className="mt-2 text-xs text-slate-400">No learners.</div>
          ) : (
            <ul className="mt-2 grid gap-1">
              {g.learners.map((l) => (
                <li key={l.name + l.percentage} className="text-sm">
                  <span className="font-semibold">{l.name}</span>{" "}
                  <span className="text-slate-500">— {l.percentage}%</span>
                  {l.weakCompetencies.length > 0 ? (
                    <span className="text-xs text-red-600">
                      {" "}
                      · weak: {l.weakCompetencies.join(", ")}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

interface ComponentListRow {
  component: string;
  attempts: number;
  average: number;
  highest: number;
  lowest: number;
}

function ComponentTable({ rows }: { rows: ComponentListRow[] }) {
  const headers = ["Component", "Attempts", "Average", "Highest", "Lowest"];
  if (rows.length === 0) {
    return <Empty text="No component data yet." />;
  }
  return (
    <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-xs text-slate-500">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.component} className="border-t border-slate-100">
              <td className="px-3 py-2 font-semibold">{c.component}</td>
              <td className="px-3 py-2">{c.attempts}</td>
              <td className="px-3 py-2 font-bold">{c.average}%</td>
              <td className="px-3 py-2">{c.highest}%</td>
              <td className="px-3 py-2">{c.lowest}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniList({
  title,
  rows,
  render,
}: {
  title: string;
  rows: ItemAnalysisRow[];
  render: (row: ItemAnalysisRow) => string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-sm font-bold">{title}</div>
      {rows.length === 0 ? (
        <div className="mt-1 text-xs text-slate-400">—</div>
      ) : (
        <ul className="mt-1 grid gap-1 text-sm">
          {rows.map((r) => (
            <li key={r.item.id}>{render(r)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SectionTitle({
  title,
  onExport,
}: {
  title: string;
  onExport?: () => void;
}) {
  return (
    <div className="mt-6 flex items-center justify-between">
      <h2 className="text-lg font-extrabold">{title}</h2>
      {onExport ? (
        <Button variant="small" onClick={onExport}>
          ⬇ CSV
        </Button>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
      <div className="text-2xl font-extrabold text-indigo-700">{value}</div>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
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

function average(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  values.forEach((v) => {
    sum += v;
  });
  return sum / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
