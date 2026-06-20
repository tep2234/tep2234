// Phase 9 — Results Dashboard + CSV export.
// Read-only view of saved results for the active assessment.

import { useState } from "react";
import type { PanelProps } from "./panel-types";
import type {
  Assessment,
  Learner,
  MasteryStatus,
  QrAssessmentState,
  Result,
} from "../lib/types";
import { MASTERY_STATUSES } from "../lib/types";
import { masteryColor } from "../lib/scoring";
import { downloadCsv, safeFilename, toCsv } from "../lib/export";
import { ActiveGate } from "./ActiveGate";
import { Button, Empty } from "./ui";

export default function ResultsPanel(props: PanelProps) {
  const { state, activeId, setActiveId } = props;
  return (
    <ActiveGate
      assessments={state.assessments}
      activeId={activeId}
      setActiveId={setActiveId}
      title="Results Dashboard"
    >
      {(active) => <ResultsView active={active} state={state} />}
    </ActiveGate>
  );
}

interface Row {
  result: Result;
  learner: Learner | undefined;
}

type SortKey = "percentDesc" | "percentAsc" | "name";

function learnerName(row: Row): string {
  return row.learner ? row.learner.fullName : "(unknown learner)";
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ResultsView({
  active,
  state,
}: {
  active: Assessment;
  state: QrAssessmentState;
}) {
  const [query, setQuery] = useState("");
  const [versionFilter, setVersionFilter] = useState<string>("all");
  const [masteryFilter, setMasteryFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("percentDesc");

  const allRows: Row[] = state.results
    .filter((r) => r.assessmentId === active.id)
    .map((r) => ({
      result: r,
      learner: state.learners.find((l) => l.id === r.learnerId),
    }));

  const q = query.trim().toLowerCase();
  const rows = allRows
    .filter((row) => {
      const name = learnerName(row).toLowerCase();
      const lrn = (row.learner ? row.learner.lrn : "").toLowerCase();
      const okQuery = q === "" || name.includes(q) || lrn.includes(q);
      const okVersion =
        versionFilter === "all" || row.result.version === versionFilter;
      const okMastery =
        masteryFilter === "all" || row.result.masteryStatus === masteryFilter;
      return okQuery && okVersion && okMastery;
    })
    .sort((a, b) => sortRows(a, b, sortKey));

  const stats = computeStats(rows);

  function exportCsv() {
    if (rows.length === 0) {
      window.alert("No results to export.");
      return;
    }
    const headers = [
      "LRN",
      "Name",
      "Section",
      "Version",
      "Component",
      "Raw",
      "Total",
      "Percent",
      "Mastery",
      "Date Checked",
    ];
    const data = rows.map((row) => [
      row.learner ? row.learner.lrn : "",
      learnerName(row),
      row.learner ? row.learner.section : "",
      row.result.version,
      active.component,
      row.result.rawScore,
      row.result.totalScore,
      row.result.percentage,
      row.result.masteryStatus,
      formatDate(row.result.createdAt),
    ]);
    const csv = toCsv(headers, data);
    downloadCsv(csv, safeFilename(active.title) + "_results.csv");
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">Results — {active.title}</h1>
          <p className="mt-1 text-slate-500">
            {active.subject} · {active.component}
          </p>
        </div>
        <Button onClick={exportCsv}>⬇ Export CSV</Button>
      </div>

      {/* Summary stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Attempts" value={String(stats.count)} />
        <Stat label="Class Avg" value={stats.avg + "%"} />
        <Stat label="Highest" value={stats.high + "%"} />
        <Stat label="Lowest" value={stats.low + "%"} />
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <label className="min-w-44 flex-1">
          <span className="mb-1 block text-xs font-bold text-slate-500">
            Search name or LRN
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-500">
            Version
          </span>
          <select
            value={versionFilter}
            onChange={(e) => setVersionFilter(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">All</option>
            {active.versions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-500">
            Mastery
          </span>
          <select
            value={masteryFilter}
            onChange={(e) => setMasteryFilter(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">All</option>
            {MASTERY_STATUSES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-bold text-slate-500">
            Sort by
          </span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="percentDesc">% high → low</option>
            <option value="percentAsc">% low → high</option>
            <option value="name">Name A → Z</option>
          </select>
        </label>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <Empty
          text={
            allRows.length === 0
              ? "No scored attempts yet. Use the Check tab."
              : "No results match the filters."
          }
        />
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                {["Name", "Section", "Ver", "Score", "%", "Mastery", "Checked"].map(
                  (h) => (
                    <th key={h} className="px-3 py-2 font-bold">
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.result.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold">{learnerName(row)}</td>
                  <td className="px-3 py-2">
                    {row.learner ? row.learner.section : ""}
                  </td>
                  <td className="px-3 py-2">{row.result.version}</td>
                  <td className="px-3 py-2">
                    {row.result.rawScore}/{row.result.totalScore}
                  </td>
                  <td className="px-3 py-2 font-bold">{row.result.percentage}%</td>
                  <td className="px-3 py-2">
                    <MasteryTag status={row.result.masteryStatus} />
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {formatDate(row.result.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function sortRows(a: Row, b: Row, key: SortKey): number {
  if (key === "name") return learnerName(a).localeCompare(learnerName(b));
  if (key === "percentAsc") return a.result.percentage - b.result.percentage;
  return b.result.percentage - a.result.percentage;
}

interface Stats {
  count: number;
  avg: number;
  high: number;
  low: number;
}

function computeStats(rows: Row[]): Stats {
  if (rows.length === 0) return { count: 0, avg: 0, high: 0, low: 0 };
  let sum = 0;
  let high = rows[0].result.percentage;
  let low = rows[0].result.percentage;
  rows.forEach((row) => {
    const p = row.result.percentage;
    sum += p;
    if (p > high) high = p;
    if (p < low) low = p;
  });
  return {
    count: rows.length,
    avg: Math.round((sum / rows.length) * 10) / 10,
    high,
    low,
  };
}

function MasteryTag({ status }: { status: MasteryStatus }) {
  return (
    <span
      className="text-xs font-bold"
      style={{ color: masteryColor(status) }}
    >
      ● {status}
    </span>
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
