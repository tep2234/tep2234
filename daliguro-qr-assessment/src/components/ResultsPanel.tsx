// Results Dashboard — operational view of saved results with the SmartScan
// lifecycle: auto-accepted → needs review → reviewed → finalized (locked).
// Finalizing freezes a score for the gradebook export; later edits require a
// reason and land in the audit trail.

import { useState } from "react";
import type { PanelProps } from "./panel-types";
import type {
  Assessment,
  Learner,
  MasteryStatus,
  QrAssessmentState,
  Result,
  ReviewStatus,
} from "../lib/types";
import { MASTERY_STATUSES } from "../lib/types";
import { masteryColor } from "../lib/scoring";
import { classStats } from "../lib/insights";
import { downloadCsv, safeFilename, toCsv } from "../lib/export";
import { ActiveGate } from "./ActiveGate";
import { Button, Empty } from "./ui";

export default function ResultsPanel(props: PanelProps) {
  const { state, setState, activeId, setActiveId } = props;
  return (
    <ActiveGate
      assessments={state.assessments}
      activeId={activeId}
      setActiveId={setActiveId}
      title="Results Dashboard"
    >
      {(active) => <ResultsView active={active} state={state} setState={setState} />}
    </ActiveGate>
  );
}

interface Row {
  result: Result;
  learner: Learner | undefined;
}

type SortKey = "percentDesc" | "percentAsc" | "name";

const STATUS_META: Record<ReviewStatus, { label: string; cls: string }> = {
  auto: { label: "auto", cls: "bg-indigo-100 text-indigo-700" },
  needs_review: { label: "review!", cls: "bg-amber-100 text-amber-800" },
  reviewed: { label: "reviewed", cls: "bg-emerald-100 text-emerald-700" },
  finalized: { label: "🔒 final", cls: "bg-slate-200 text-slate-700" },
};

function learnerName(row: Row): string {
  return row.learner ? row.learner.fullName : "(unknown learner)";
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Module-level so the react-hooks purity rule sees the Date.now() call is
// outside component render scope (these run only from event handlers).
function finalizeResults(results: Result[], ids: Set<string>, bulk: boolean): Result[] {
  const now = Date.now();
  return results.map((r) =>
    ids.has(r.id) && (r.reviewStatus === "reviewed" || r.reviewStatus === "auto")
      ? {
          ...r,
          reviewStatus: "finalized" as const,
          finalizedAt: now,
          auditLog: r.auditLog.concat({
            at: now,
            action: bulk ? "Finalized (locked, bulk)" : "Finalized (locked)",
          }),
          updatedAt: now,
        }
      : r,
  );
}

function ResultsView({
  active,
  state,
  setState,
}: {
  active: Assessment;
  state: QrAssessmentState;
  setState: PanelProps["setState"];
}) {
  const [query, setQuery] = useState("");
  const [versionFilter, setVersionFilter] = useState<string>("all");
  const [masteryFilter, setMasteryFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("percentDesc");
  const [historyId, setHistoryId] = useState<string | null>(null);

  const allResults = state.results.filter((r) => r.assessmentId === active.id);
  const allRows: Row[] = allResults.map((r) => ({
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

  const stats = classStats(allResults);
  const pending = allResults.filter((r) => r.reviewStatus === "needs_review").length;
  const finalized = allResults.filter((r) => r.reviewStatus === "finalized").length;
  const readyToFinalize = allResults.filter(
    (r) => r.reviewStatus === "reviewed" || r.reviewStatus === "auto",
  ).length;

  function finalizeOne(id: string) {
    setState((prev) => ({
      ...prev,
      results: finalizeResults(prev.results, new Set([id]), false),
    }));
  }

  function finalizeAll() {
    if (
      !window.confirm(
        `Finalize ${readyToFinalize} result(s)? Finalized scores are locked; later changes require a reason and are audit-logged.`,
      )
    ) {
      return;
    }
    setState((prev) => ({
      ...prev,
      results: finalizeResults(
        prev.results,
        new Set(prev.results.filter((r) => r.assessmentId === active.id).map((r) => r.id)),
        true,
      ),
    }));
  }

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
      "Status",
      "Trust",
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
      row.result.reviewStatus,
      row.result.scanConfidence !== null ? Math.round(row.result.scanConfidence * 100) + "%" : "",
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
        <div className="flex gap-2">
          {readyToFinalize > 0 ? (
            <Button variant="ghost" onClick={finalizeAll}>
              🔒 Finalize all ({readyToFinalize})
            </Button>
          ) : null}
          <Button onClick={exportCsv}>⬇ Export CSV</Button>
        </div>
      </div>

      {/* Lifecycle + summary cards */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total Learners" value={String(state.learners.length)} />
        <Stat label="Scanned" value={String(allResults.filter((r) => r.source === "scan").length)} />
        <Stat label="Checked" value={String(stats.count)} />
        <Stat label="Needs Review" value={String(pending)} tone={pending > 0 ? "warn" : undefined} />
        <Stat label="Passing Rate" value={stats.passingRate + "%"} />
        <Stat label="Average Score" value={stats.average + "%"} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Finalized" value={String(finalized)} />
        <Stat label="High / Low" value={stats.highest + " / " + stats.lowest} />
        <Stat label="Ready to Finalize" value={String(readyToFinalize)} />
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
              ? "No scored attempts yet. Use the SmartScan tab."
              : "No results match the filters."
          }
        />
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                {["Name", "Ver", "Score", "%", "Mastery", "Status", "Trust", "Checked", ""].map(
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
                <ResultRow
                  key={row.result.id}
                  row={row}
                  showHistory={historyId === row.result.id}
                  onToggleHistory={() =>
                    setHistoryId(historyId === row.result.id ? null : row.result.id)
                  }
                  onFinalize={() => finalizeOne(row.result.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ResultRow({
  row,
  showHistory,
  onToggleHistory,
  onFinalize,
}: {
  row: Row;
  showHistory: boolean;
  onToggleHistory: () => void;
  onFinalize: () => void;
}) {
  const r = row.result;
  const status = STATUS_META[r.reviewStatus];
  const canFinalize = r.reviewStatus === "reviewed" || r.reviewStatus === "auto";
  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="px-3 py-2 font-semibold">{learnerName(row)}</td>
        <td className="px-3 py-2">{r.version}</td>
        <td className="px-3 py-2">
          {r.rawScore}/{r.totalScore}
        </td>
        <td className="px-3 py-2 font-bold">{r.percentage}%</td>
        <td className="px-3 py-2">
          <MasteryTag status={r.masteryStatus} />
        </td>
        <td className="px-3 py-2">
          <span className={"rounded px-2 py-0.5 text-xs font-bold " + status.cls}>
            {status.label}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-slate-500">
          {r.scanConfidence !== null ? Math.round(r.scanConfidence * 100) + "%" : "—"}
        </td>
        <td className="px-3 py-2 text-xs text-slate-500">{formatDate(r.createdAt)}</td>
        <td className="px-3 py-2">
          <div className="flex gap-1">
            {canFinalize ? (
              <Button variant="small" onClick={onFinalize}>
                🔒
              </Button>
            ) : null}
            <button
              className="text-xs font-bold text-slate-400 hover:text-indigo-700"
              onClick={onToggleHistory}
              title="Audit history"
            >
              {showHistory ? "▲" : "≡"}
            </button>
          </div>
        </td>
      </tr>
      {showHistory ? (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td colSpan={9} className="px-3 py-2">
            <div className="text-xs font-bold text-slate-500">Audit history</div>
            {r.auditLog.length === 0 ? (
              <div className="text-xs text-slate-400">No entries.</div>
            ) : (
              <ul className="mt-1 grid gap-0.5 text-xs text-slate-600">
                {r.auditLog.map((e, i) => (
                  <li key={i}>
                    {formatDate(e.at)} — {e.action}
                    {e.reason ? ` (reason: ${e.reason})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function sortRows(a: Row, b: Row, key: SortKey): number {
  if (key === "name") return learnerName(a).localeCompare(learnerName(b));
  if (key === "percentAsc") return a.result.percentage - b.result.percentage;
  return b.result.percentage - a.result.percentage;
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div
      className={
        "rounded-2xl border p-3 text-center shadow-sm " +
        (tone === "warn" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white")
      }
    >
      <div className={"text-xl font-extrabold " + (tone === "warn" ? "text-amber-700" : "text-indigo-700")}>
        {value}
      </div>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
    </div>
  );
}
