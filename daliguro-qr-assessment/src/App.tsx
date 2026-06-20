import { useState } from "react";
import { useQrStore } from "./lib/useQrStore";
import type { QrAssessmentState } from "./lib/types";

type TabId =
  | "setup"
  | "items"
  | "learners"
  | "sheets"
  | "check"
  | "results"
  | "analysis";

interface TabDef {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabDef[] = [
  { id: "setup", label: "Setup", icon: "📝" },
  { id: "items", label: "Items", icon: "🔢" },
  { id: "learners", label: "Learners", icon: "👥" },
  { id: "sheets", label: "QR Sheets", icon: "🔳" },
  { id: "check", label: "Check", icon: "✓" },
  { id: "results", label: "Results", icon: "🎯" },
  { id: "analysis", label: "Analysis", icon: "📊" },
];

export default function App() {
  const { state, loaded } = useQrStore();
  const [tab, setTab] = useState<TabId>("setup");

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Loading DALIguro QR…
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3 bg-indigo-700 px-5 py-3 text-white">
        <div className="text-xl font-extrabold tracking-wide">
          DALI<span className="text-amber-400">guro</span>
        </div>
        <div className="text-sm opacity-90">QR Assessment — Standalone</div>
        <span className="ml-auto rounded-full border border-emerald-400 bg-emerald-500/20 px-3 py-1 text-xs font-bold">
          ● OFFLINE-FIRST · saved on this device
        </span>
      </header>

      {/* Tab navigation */}
      <nav className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2">
        {TABS.map((t) => {
          const active = t.id === tab;
          const cls = active
            ? "bg-indigo-700 text-white"
            : "bg-transparent text-slate-500 hover:bg-slate-100";
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-bold " +
                cls
              }
            >
              <span className="text-base">{t.icon}</span>
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* Tab content */}
      <main className="mx-auto max-w-5xl p-4">
        <TabPanel tab={tab} counts={summarize(state)} />
      </main>
    </div>
  );
}

interface Counts {
  assessments: number;
  items: number;
  learners: number;
  results: number;
}

function summarize(state: QrAssessmentState): Counts {
  return {
    assessments: state.assessments.length,
    items: state.items.length,
    learners: state.learners.length,
    results: state.results.length,
  };
}

const TAB_TITLES: Record<TabId, string> = {
  setup: "Assessment Setup",
  items: "Items & Answer Key",
  learners: "Learner Manager",
  sheets: "QR Answer Sheets",
  check: "Assisted Checking",
  results: "Results Dashboard",
  analysis: "Analysis Dashboard",
};

function TabPanel({ tab, counts }: { tab: TabId; counts: Counts }) {
  const title = TAB_TITLES[tab];

  return (
    <section>
      <h1 className="text-2xl font-extrabold">{title}</h1>
      <p className="mt-1 text-slate-500">
        This panel is part of the build spine. Phases 4–10 fill it in.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Assessments" value={counts.assessments} />
        <StatCard label="Items" value={counts.items} />
        <StatCard label="Learners" value={counts.learners} />
        <StatCard label="Results" value={counts.results} />
      </div>

      <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
        <div className="text-lg font-semibold text-slate-700">
          “{title}” coming in a later phase
        </div>
        <p className="mt-2 text-sm">
          The route, shell, data model, and offline storage are working. Counts
          above are loaded from local storage and survive a page reload.
        </p>
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-center">
      <div className="text-3xl font-extrabold text-indigo-700">{value}</div>
      <div className="mt-1 text-sm font-semibold text-slate-500">{label}</div>
    </div>
  );
}
