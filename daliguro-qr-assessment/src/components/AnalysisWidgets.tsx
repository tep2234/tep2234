// Analysis visual widgets: mastery distribution (status-colored bars with
// labels + counts — never color alone) and score distribution (single-hue
// histogram). Text stays in ink tokens; marks carry the color.

import { useState } from "react";
import type { MasteryStatus, Result } from "../lib/types";
import { MASTERY_STATUSES } from "../lib/types";
import { masteryColor } from "../lib/scoring";
import type { MasteryDistribution } from "../lib/analysis";
import { Button } from "./ui";

export function MasteryBars({ dist, total }: { dist: MasteryDistribution; total: number }) {
  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-sm font-bold">Mastery distribution</div>
      <div className="mt-2 grid gap-2">
        {MASTERY_STATUSES.map((m: MasteryStatus) => {
          const count = dist[m];
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={m} className="flex items-center gap-3" title={`${m}: ${count} learner(s) (${pct}%)`}>
              <span className="w-44 shrink-0 text-xs font-semibold text-slate-700">{m}</span>
              <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100">
                <div
                  className="h-full rounded"
                  style={{
                    width: pct + "%",
                    minWidth: count > 0 ? "6px" : "0",
                    background: masteryColor(m),
                  }}
                />
              </div>
              <span className="w-20 shrink-0 text-right text-xs font-bold text-slate-700">
                {count} · {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 10-point bins: 0–9 … 80–89, 90–100 (last bin inclusive of 100).
function binScores(results: Result[]): number[] {
  const bins = new Array<number>(10).fill(0);
  results.forEach((r) => {
    const i = Math.min(9, Math.floor(r.percentage / 10));
    bins[i] += 1;
  });
  return bins;
}

export function ScoreHistogram({ results }: { results: Result[] }) {
  const bins = binScores(results);
  const max = Math.max(1, ...bins);
  return (
    <div className="mt-2 rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-sm font-bold">Score distribution (%)</div>
      <div className="mt-3 flex h-32 items-end gap-1">
        {bins.map((count, i) => {
          const label = i === 9 ? "90–100" : `${i * 10}–${i * 10 + 9}`;
          const h = count > 0 ? Math.max(6, Math.round((count / max) * 100)) : 0;
          return (
            <div
              key={i}
              className="flex flex-1 flex-col items-center justify-end gap-1"
              title={`${label}%: ${count} learner(s)`}
            >
              {count > 0 ? (
                <span className="text-[10px] font-bold text-slate-600">{count}</span>
              ) : null}
              <div
                className="w-full rounded-t bg-indigo-500"
                style={{ height: h + "%" }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 border-t border-slate-200 pt-1">
        {bins.map((_, i) => (
          <div key={i} className="flex-1 text-center text-[10px] text-slate-400">
            {i % 2 === 0 ? i * 10 : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

// Copyable rule-based narrative (Smart Teacher Summary / reflection).
export function CopyCard({ title, text }: { title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => window.prompt("Copy the text below:", text));
  }
  return (
    <div className="mt-2 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-extrabold text-indigo-900">{title}</div>
        <Button variant="small" onClick={copy}>
          {copied ? "✓ Copied" : "📋 Copy"}
        </Button>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-indigo-950">{text}</p>
    </div>
  );
}
