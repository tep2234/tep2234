// Analysis table subcomponents — extracted from AnalysisPanel so the panel
// stays focused on composing the dashboard.

import type { Item } from "../lib/types";
import { masteryColor } from "../lib/scoring";
import type { CompetencyRow, ItemAnalysisRow } from "../lib/analysis";
import { Button, Empty } from "./ui";

export function ItemAnalysisTable({
  rows,
  discByItem,
  flagsByItem,
}: {
  rows: ItemAnalysisRow[];
  discByItem: Map<string, number | null>;
  flagsByItem: Map<string, string[]>;
}) {
  const headers = ["No", "Type", "Competency", "Pts", "✓", "✗", "blank", "%", "Difficulty", "Disc.", "Flags"];
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
          {rows.map((r) => {
            const disc = discByItem.get(r.item.id) ?? null;
            const flags = flagsByItem.get(r.item.id) ?? [];
            return (
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
                <td className="px-3 py-2 text-xs">{disc === null ? "—" : disc}</td>
                <td className="px-3 py-2">
                  {flags.length > 0 ? (
                    <span className="text-xs font-bold text-amber-700" title={flags.join("\n")}>
                      ⚠ {flags.length}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CommonWrong({
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

export function CompetencyTable({ rows }: { rows: CompetencyRow[] }) {
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

export interface ComponentListRow {
  component: string;
  attempts: number;
  average: number;
  highest: number;
  lowest: number;
}

export function ComponentTable({ rows }: { rows: ComponentListRow[] }) {
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

export function MiniList({
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

export function SectionTitle({
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
