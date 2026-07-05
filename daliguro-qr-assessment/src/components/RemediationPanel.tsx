// Remediation tab — automatic support groups from saved results.
// Group A (Critical Support) → Group D (Mastered), each with its learners,
// weak competencies, a suggested activity, and a follow-up. Includes the
// performance-based Learning Attention Flags (observable data only — this is
// NOT a claim of measuring attention). Printable for offline use.

import type { PanelProps } from "./panel-types";
import type {
  Assessment,
  MasteryStatus,
  QrAssessmentState,
} from "../lib/types";
import { masteryColor } from "../lib/scoring";
import { remediationGroups, type RemediationGroup } from "../lib/analysis";
import { attentionFor, type AttentionFlag } from "../lib/insights";
import { downloadCsv, safeFilename, toCsv } from "../lib/export";
import { ActiveGate } from "./ActiveGate";
import { Button, Empty } from "./ui";

export default function RemediationPanel(props: PanelProps) {
  const { state, activeId, setActiveId } = props;
  return (
    <ActiveGate
      assessments={state.assessments}
      activeId={activeId}
      setActiveId={setActiveId}
      title="Remediation"
    >
      {(active) => <RemediationView active={active} state={state} />}
    </ActiveGate>
  );
}

// Display order for remediation: most urgent first.
const GROUP_LETTERS: Record<MasteryStatus, string> = {
  "Critical Support": "A",
  "Needs Reinforcement": "B",
  "Near Mastery": "C",
  Mastered: "D",
};

const ACTIVITIES: Record<MasteryStatus, { task: string; followUp: string }> = {
  "Critical Support": {
    task: "Guided remediation worksheet with solved examples, teacher-led step-by-step",
    followUp: "5-item follow-up quiz after the reteaching session",
  },
  "Needs Reinforcement": {
    task: "Practice set with hints and worked examples, pair activity",
    followUp: "Short correction activity on the missed items",
  },
  "Near Mastery": {
    task: "Short review and targeted practice on missed items",
    followUp: "3-item exit ticket",
  },
  Mastered: {
    task: "Enrichment challenge or peer-tutoring role",
    followUp: "Optional extension task",
  },
};

const FLAG_TONE: Record<AttentionFlag, string> = {
  "On Track": "bg-emerald-100 text-emerald-700",
  "Needs Monitoring": "bg-sky-100 text-sky-700",
  "Needs Support": "bg-amber-100 text-amber-800",
  "Needs Immediate Remediation": "bg-red-100 text-red-700",
};

function RemediationView({
  active,
  state,
}: {
  active: Assessment;
  state: QrAssessmentState;
}) {
  const items = state.items.filter((i) => i.assessmentId === active.id);
  const results = state.results.filter((r) => r.assessmentId === active.id);

  if (results.length === 0) {
    return (
      <section>
        <h1 className="text-2xl font-extrabold">Remediation</h1>
        <Empty text="No checked results yet. Scan or check answer sheets first." />
      </section>
    );
  }

  const groups = remediationGroups(items, results, state.learners)
    .slice()
    .sort(
      (a, b) =>
        GROUP_LETTERS[a.status].localeCompare(GROUP_LETTERS[b.status]),
    );

  const itemsById = new Map(items.map((i) => [i.id, i]));
  const learnersById = new Map(state.learners.map((l) => [l.id, l]));
  const attention = results
    .map((r) => ({
      name: learnersById.get(r.learnerId)?.fullName ?? "(unknown learner)",
      reading: attentionFor(r, itemsById),
      percentage: r.percentage,
    }))
    .sort((a, b) => a.percentage - b.percentage);

  function exportCsv() {
    const headers = [
      "Group",
      "Status",
      "Learner",
      "Percentage",
      "WeakCompetencies",
      "SuggestedActivity",
      "FollowUp",
    ];
    const data: (string | number)[][] = [];
    groups.forEach((g) => {
      g.learners.forEach((l) => {
        data.push([
          "Group " + GROUP_LETTERS[g.status],
          g.status,
          l.name,
          l.percentage,
          l.weakCompetencies.join("; "),
          ACTIVITIES[g.status].task,
          ACTIVITIES[g.status].followUp,
        ]);
      });
    });
    downloadCsv(toCsv(headers, data), safeFilename(active.title) + "_remediation.csv");
  }

  return (
    <section>
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">Remediation — {active.title}</h1>
          <p className="mt-1 text-slate-500">
            Automatic support groups from the latest results. Print this for your intervention log.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={exportCsv}>⬇ CSV</Button>
          <Button onClick={() => window.print()}>🖨 Print</Button>
        </div>
      </div>

      <div className="print-area">
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {groups.map((g) => (
            <GroupCard key={g.status} group={g} />
          ))}
        </div>

        {/* Learning attention flags */}
        <h2 className="mt-6 text-lg font-extrabold">Learning Attention Flags</h2>
        <p className="mt-1 text-xs text-slate-500">
          Performance-based flags from observable data (score, blanks, patterns) — not a
          measurement of attention itself.
        </p>
        <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs text-slate-500">
                {["Learner", "%", "Flag", "Why"].map((h) => (
                  <th key={h} className="px-3 py-2 font-bold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attention.map((a) => (
                <tr key={a.name + a.percentage} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-semibold">{a.name}</td>
                  <td className="px-3 py-2 font-bold">{a.percentage}%</td>
                  <td className="px-3 py-2">
                    <span className={"rounded px-2 py-0.5 text-xs font-bold " + FLAG_TONE[a.reading.flag]}>
                      {a.reading.flag}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {a.reading.reasons.join("; ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function GroupCard({ group }: { group: RemediationGroup }) {
  const letter = GROUP_LETTERS[group.status];
  const acts = ACTIVITIES[group.status];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-extrabold text-white"
          style={{ background: masteryColor(group.status) }}
        >
          {letter}
        </span>
        <div>
          <div className="text-sm font-extrabold" style={{ color: masteryColor(group.status) }}>
            Group {letter} — {group.status}
          </div>
          <div className="text-xs text-slate-500">{group.learners.length} learner(s)</div>
        </div>
      </div>

      <div className="mt-2 rounded-lg bg-slate-50 p-2 text-xs">
        <div>
          <b>Activity:</b> {acts.task}
        </div>
        <div className="mt-0.5">
          <b>Follow-up:</b> {acts.followUp}
        </div>
      </div>

      {group.learners.length === 0 ? (
        <div className="mt-2 text-xs text-slate-400">No learners in this group.</div>
      ) : (
        <ul className="mt-2 grid gap-1">
          {group.learners.map((l) => (
            <li key={l.name + l.percentage} className="text-sm">
              <span className="font-semibold">{l.name}</span>{" "}
              <span className="text-slate-500">— {l.percentage}%</span>
              {l.weakCompetencies.length > 0 ? (
                <div className="text-xs text-red-600">
                  weak: {l.weakCompetencies.join(", ")}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
