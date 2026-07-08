// Remediation tab — automatic support groups from saved results.
// Group A (Critical Support) → Group D (Mastered), each with its learners,
// weak competencies, a suggested activity, and a follow-up. Includes the
// performance-based Learning Attention Flags (observable data only — this is
// NOT a claim of measuring attention). Printable for offline use.

import type { PanelProps } from "./panel-types";
import type {
  Assessment,
  Item,
  MasteryStatus,
  QrAssessmentState,
  Result,
} from "../lib/types";
import { masteryColor } from "../lib/scoring";
import { analyzeItems, remediationGroups, type RemediationGroup } from "../lib/analysis";
import { attentionFor, classStats, PASSING_PERCENT, type AttentionFlag } from "../lib/insights";
import { downloadCsv, safeFilename, toCsv } from "../lib/export";
import { INTEL_MASTERY_COLOR, intelMastery } from "../lib/report-intel";
import { trustedResults } from "../lib/result-trust";
import { ActiveGate } from "./ActiveGate";
import { Button } from "./ui";

export default function RemediationPanel(props: PanelProps) {
  const { state, activeId, setActiveId, navigate } = props;
  return (
    <ActiveGate
      assessments={state.assessments}
      activeId={activeId}
      setActiveId={setActiveId}
      title="Remediation"
    >
      {(active) => <RemediationView active={active} state={state} navigate={navigate} />}
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
  navigate,
}: {
  active: Assessment;
  state: QrAssessmentState;
  navigate?: (tab: string) => void;
}) {
  const items = state.items.filter((i) => i.assessmentId === active.id);
  const allResults = state.results.filter((r) => r.assessmentId === active.id);
  const results = trustedResults(allResults);
  const stats = classStats(results);
  const itemRows = analyzeItems(items, results);
  const difficultItems = itemRows.filter((r) => r.attempts > 0 && r.percentCorrect < 30);
  const weakest = itemRows
    .filter((r) => r.attempts > 0)
    .sort((a, b) => a.percentCorrect - b.percentCorrect)[0];
  const needsRemediation = results.filter((r) => r.percentage < PASSING_PERCENT).length;
  const lastScan = results.length
    ? new Date(Math.max(...results.map((r) => r.updatedAt || r.createdAt))).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "No scans yet";

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
  const learnersByPct = [...results].sort((a, b) => a.percentage - b.percentage);

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
          <h1 className="text-2xl font-black text-slate-950">Remediation Intelligence — {active.title}</h1>
          <p className="mt-1 text-slate-500">
            Automatic support groups, weak areas, and teacher-ready intervention actions.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={exportCsv}>⬇ CSV</Button>
          <Button onClick={() => window.print()}>🖨 Print</Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Students Needing Remediation" value={String(needsRemediation)} note={`${results.length} checked learner(s)`} tone="red" />
        <Kpi label="Lowest Mastery Area" value={weakest ? `Item ${weakest.item.itemNumber}` : "Pending"} note={weakest ? `${weakest.percentCorrect}% correct` : "Needs checked results"} tone="orange" />
        <Kpi label="Items Below Mastery" value={String(difficultItems.length)} note="Below 30% correct" tone="orange" />
        <Kpi label="Average MPS" value={stats.average + "%"} note="Class average" tone="blue" />
        <Kpi label="Last Scan Status" value={lastScan} note={results.length ? "Data available" : "No checked results"} tone={results.length ? "green" : "slate"} />
      </div>

      <div className="print-area">
        <h2 className="mt-6 text-lg font-black text-slate-950">Remediation Groups</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MasteryGroupCard label="Beginning" color="#dc2626" count={results.filter((r) => intelMastery(r.percentage) === "Beginning").length} note="Immediate remediation" />
          <MasteryGroupCard label="Developing" color="#d97706" count={results.filter((r) => intelMastery(r.percentage) === "Developing").length} note="Small group support" />
          <MasteryGroupCard label="Approaching Mastery" color="#4f46e5" count={results.filter((r) => intelMastery(r.percentage) === "Approaching Mastery").length} note="Targeted practice" />
          <MasteryGroupCard label="Mastered" color="#16a34a" count={results.filter((r) => intelMastery(r.percentage) === "Mastered").length} note="Enrichment" />
        </div>

        <h2 className="mt-6 text-lg font-black text-slate-950">Suggested Interventions</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <InterventionCard title="Whole-class reteaching" text={weakest ? `Reteach Item ${weakest.item.itemNumber}: ${weakest.competency}` : "Use after the first checked scan identifies weak areas."} />
          <InterventionCard title="Small group remediation" text="Group learners by Beginning and Developing mastery bands for guided practice." />
          <InterventionCard title="Individual coaching" text="Prioritize learners with low MPS, blanks, or repeated missed easy items." />
          <InterventionCard title="Enrichment activity" text="Assign extension tasks to Mastered learners while remediation is running." />
        </div>

        <h2 className="mt-6 text-lg font-black text-slate-950">Learner Remediation Table</h2>
        <div className="mt-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                {["Learner", "Score", "MPS", "Mastery Status", "Weak Items", "Recommended Action"].map((h) => (
                  <th key={h} className="px-3 py-3 font-black">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {learnersByPct.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8">
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                      <div className="text-lg font-black text-slate-900">No checked results yet.</div>
                      <p className="mt-1 text-sm text-slate-500">
                        Scan answer sheets using SmartScan or review pending scans to generate remediation groups.
                      </p>
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        <Button onClick={() => navigate?.("smartscan")}>Open SmartScan</Button>
                        <Button variant="ghost" onClick={() => navigate?.("review")}>Go to Review</Button>
                        <Button variant="ghost" onClick={() => navigate?.("reports")}>View Sample Report</Button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                learnersByPct.map((r) => <RemediationRow key={r.id} result={r} state={state} items={items} />)
              )}
            </tbody>
          </table>
        </div>

        {groups.length > 0 ? (
          <>
            <h2 className="mt-6 text-lg font-black text-slate-950">Detailed Support Groups</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {groups.map((g) => (
                <GroupCard key={g.status} group={g} />
              ))}
            </div>
          </>
        ) : null}

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

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone: "red" | "orange" | "blue" | "green" | "slate" }) {
  const cls = {
    red: "border-red-200 bg-red-50 text-red-700",
    orange: "border-orange-200 bg-orange-50 text-orange-700",
    blue: "border-indigo-200 bg-indigo-50 text-indigo-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    slate: "border-slate-200 bg-white text-slate-700",
  }[tone];
  return (
    <div className={"rounded-2xl border p-4 shadow-sm " + cls}>
      <div className="text-xs font-black uppercase opacity-75">{label}</div>
      <div className="mt-2 text-2xl font-black leading-tight">{value}</div>
      <div className="mt-1 text-xs font-bold opacity-75">{note}</div>
    </div>
  );
}

function MasteryGroupCard({ label, count, color, note }: { label: string; count: number; color: string; note: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-950">{label}</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">{note}</div>
        </div>
        <div className="grid h-12 w-12 place-items-center rounded-full text-xl font-black text-white" style={{ background: color }}>
          {count}
        </div>
      </div>
    </div>
  );
}

function InterventionCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-black text-slate-950">{title}</div>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">{text}</p>
    </div>
  );
}

function RemediationRow({ result, state, items }: { result: Result; state: QrAssessmentState; items: Item[] }) {
  const learner = state.learners.find((l) => l.id === result.learnerId);
  const mastery = intelMastery(result.percentage);
  const weakItems = result.itemScores
    .filter((s) => !s.manual && !s.correct)
    .map((s) => s.itemNumber)
    .slice(0, 8);
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const attention = attentionFor(result, itemsById);
  return (
    <tr className="border-t border-slate-100 align-top">
      <td className="px-3 py-3 font-semibold text-slate-900">{learner?.fullName ?? "(unknown learner)"}</td>
      <td className="px-3 py-3 font-bold">{result.rawScore}/{result.totalScore}</td>
      <td className="px-3 py-3 font-black text-indigo-900">{result.percentage}%</td>
      <td className="px-3 py-3">
        <span className="rounded-full px-2 py-1 text-xs font-black" style={{ background: INTEL_MASTERY_COLOR[mastery] + "20", color: INTEL_MASTERY_COLOR[mastery] }}>
          {mastery}
        </span>
      </td>
      <td className="px-3 py-3 text-xs font-semibold text-slate-600">{weakItems.length ? weakItems.join(", ") : "None"}</td>
      <td className="px-3 py-3 text-xs text-slate-500">{attention.flag}</td>
    </tr>
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
