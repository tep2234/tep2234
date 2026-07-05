import { useState } from "react";
import { useQrStore } from "./lib/useQrStore";
import type { PanelProps } from "./components/panel-types";
import SetupPanel from "./components/SetupPanel";
import ItemsPanel from "./components/ItemsPanel";
import LearnersPanel from "./components/LearnersPanel";
import SheetsPanel from "./components/SheetsPanel";
import CheckPanel from "./components/CheckPanel";
import ReviewPanel from "./components/ReviewPanel";
import ResultsPanel from "./components/ResultsPanel";
import AnalysisPanel from "./components/AnalysisPanel";
import RemediationPanel from "./components/RemediationPanel";
import ReportsPanel from "./components/ReportsPanel";

type TabId =
  | "setup"
  | "items"
  | "learners"
  | "sheets"
  | "smartscan"
  | "review"
  | "results"
  | "analysis"
  | "remediation"
  | "reports";

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
  { id: "smartscan", label: "SmartScan", icon: "📷" },
  { id: "review", label: "Review", icon: "🔍" },
  { id: "results", label: "Results", icon: "🎯" },
  { id: "analysis", label: "Analysis", icon: "📊" },
  { id: "remediation", label: "Remediation", icon: "🧭" },
  { id: "reports", label: "Reports", icon: "📄" },
];

export default function App() {
  const { state, setState, loaded } = useQrStore();
  const [tab, setTab] = useState<TabId>("setup");
  const [activeId, setActiveId] = useState<string | null>(null);

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Loading DALIguro SmartScan…
      </div>
    );
  }

  const active = state.assessments.find((a) => a.id === activeId) ?? null;
  const panelProps: PanelProps = { state, setState, activeId, setActiveId };
  const pendingReview = state.results.filter((r) => r.reviewStatus === "needs_review").length;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="no-print flex flex-wrap items-center gap-3 bg-indigo-700 px-5 py-3 text-white">
        <div className="text-xl font-extrabold tracking-wide">
          DALI<span className="text-amber-400">guro</span>
        </div>
        <div className="text-sm opacity-90">SmartScan Assessment Engine</div>
        <span className="ml-auto rounded-full border border-emerald-400 bg-emerald-500/20 px-3 py-1 text-xs font-bold">
          ● OFFLINE-FIRST · saved on this device
        </span>
      </header>

      {/* Tab navigation */}
      <nav className="no-print sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2">
        {TABS.map((t) => {
          const isActiveTab = t.id === tab;
          const cls = isActiveTab
            ? "bg-indigo-700 text-white"
            : "bg-transparent text-slate-500 hover:bg-slate-100";
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                "relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-bold " +
                cls
              }
            >
              <span className="text-base">{t.icon}</span>
              {t.label}
              {t.id === "review" && pendingReview > 0 ? (
                <span className="ml-1 rounded-full bg-amber-400 px-1.5 text-xs font-extrabold text-amber-950">
                  {pendingReview}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* Tab content */}
      <main className="mx-auto max-w-5xl p-4">
        {active && tab !== "setup" ? (
          <div className="no-print mb-3 flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm">
            <span>
              Active assessment: <b>{active.title}</b> · {active.subject} ·{" "}
              {active.section}
            </span>
            <button
              className="font-bold text-indigo-700"
              onClick={() => setActiveId(null)}
            >
              clear
            </button>
          </div>
        ) : null}

        {renderTab(tab, panelProps)}
      </main>
    </div>
  );
}

function renderTab(tab: TabId, panelProps: PanelProps) {
  if (tab === "setup") return <SetupPanel {...panelProps} />;
  if (tab === "items") return <ItemsPanel {...panelProps} />;
  if (tab === "learners") return <LearnersPanel {...panelProps} />;
  if (tab === "sheets") return <SheetsPanel {...panelProps} />;
  if (tab === "smartscan") return <CheckPanel {...panelProps} />;
  if (tab === "review") return <ReviewPanel {...panelProps} />;
  if (tab === "results") return <ResultsPanel {...panelProps} />;
  if (tab === "analysis") return <AnalysisPanel {...panelProps} />;
  if (tab === "remediation") return <RemediationPanel {...panelProps} />;
  return <ReportsPanel {...panelProps} />;
}
