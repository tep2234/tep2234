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
  | "overview"
  | "setup"
  | "items"
  | "learners"
  | "sheets"
  | "smartscan"
  | "review"
  | "results"
  | "analysis"
  | "item-analysis"
  | "remediation"
  | "reports"
  | "classes"
  | "settings";

interface TabDef {
  id: TabId;
  label: string;
  icon: string;
}

interface NavItem {
  id: TabId;
  label: string;
  icon: string;
  badge?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const TABS: TabDef[] = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "setup", label: "Setup", icon: "📝" },
  { id: "items", label: "Items", icon: "🔢" },
  { id: "learners", label: "Learners", icon: "👥" },
  { id: "sheets", label: "QR Sheets", icon: "🔳" },
  { id: "smartscan", label: "SmartScan", icon: "📷" },
  { id: "review", label: "Review", icon: "🔍" },
  { id: "results", label: "Results", icon: "🎯" },
  { id: "analysis", label: "Analysis", icon: "📊" },
  { id: "item-analysis", label: "Item Analysis", icon: "▧" },
  { id: "remediation", label: "Remediation", icon: "🧭" },
  { id: "reports", label: "Reports", icon: "📄" },
  { id: "classes", label: "Classes", icon: "◫" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

const PAGE_META: Record<TabId, { title: string; crumb: string }> = {
  overview: { title: "Reports and Assessment Intelligence", crumb: "Executive Overview · Overview" },
  setup: { title: "Assessment Setup", crumb: "Assessment Setup · Setup" },
  items: { title: "Item Bank and Answer Keys", crumb: "Assessment Setup · Items" },
  learners: { title: "Learner Masterlist", crumb: "Assessment Setup · Learners" },
  sheets: { title: "QR Answer Sheets", crumb: "Assessment Setup · QR Sheets" },
  smartscan: { title: "SmartScan Workspace", crumb: "Scanning Workflow · SmartScan" },
  review: { title: "Scan Review Queue", crumb: "Scanning Workflow · Review" },
  results: { title: "Results Dashboard", crumb: "Scanning Workflow · Results" },
  analysis: { title: "Assessment Analysis", crumb: "Intelligence · Analysis" },
  "item-analysis": { title: "Smart Item Analysis", crumb: "Intelligence · Item Analysis" },
  remediation: { title: "Remediation Intelligence", crumb: "Intelligence · Remediation" },
  reports: { title: "Reports and Assessment Intelligence", crumb: "Executive Overview · Reports" },
  classes: { title: "Classes and Learners", crumb: "System · Classes" },
  settings: { title: "Assessment Settings", crumb: "System · Settings" },
};

export default function App() {
  const { state, setState, loaded } = useQrStore();
  const [tab, setTab] = useState<TabId>("overview");
  const [activeId, setActiveId] = useState<string | null>(null);

  if (!loaded) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Loading DALIguro SmartScan…
      </div>
    );
  }

  const effectiveActiveId = activeId ?? state.assessments[0]?.id ?? null;
  const active = state.assessments.find((a) => a.id === effectiveActiveId) ?? null;
  const panelProps: PanelProps = { state, setState, activeId: effectiveActiveId, setActiveId, navigate: (next) => setTab(next as TabId) };
  const pendingReview = state.results.filter((r) => r.reviewStatus === "needs_review").length;
  const activeResults = active ? state.results.filter((r) => r.assessmentId === active.id) : [];
  const currentMeta = PAGE_META[tab];
  const navGroups: NavGroup[] = [
    {
      label: "Assessment Setup",
      items: [
        { id: "overview", label: "Overview", icon: "⌂" },
        { id: "setup", label: "Setup", icon: "▣" },
        { id: "items", label: "Items", icon: "≡" },
        { id: "learners", label: "Learners", icon: "◉" },
        { id: "sheets", label: "QR Sheets", icon: "▦" },
      ],
    },
    {
      label: "Scanning Workflow",
      items: [
        { id: "smartscan", label: "SmartScan", icon: "◎" },
        { id: "review", label: "Review", icon: "◇", badge: pendingReview },
        { id: "results", label: "Results", icon: "↗" },
      ],
    },
    {
      label: "Intelligence",
      items: [
        { id: "analysis", label: "Analysis", icon: "▥" },
        { id: "remediation", label: "Remediation", icon: "◌" },
        { id: "reports", label: "Reports", icon: "▤" },
        { id: "item-analysis", label: "Item Analysis", icon: "▧" },
      ],
    },
    {
      label: "System",
      items: [
        { id: "classes", label: "Classes", icon: "◫" },
        { id: "settings", label: "Settings", icon: "⚙" },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-[#eef3fa]">
      <div className="grid min-h-screen lg:grid-cols-[280px_1fr]">
        <aside className="no-print hidden bg-[#06255b] text-white shadow-2xl lg:flex lg:flex-col">
          <div className="px-6 py-7">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-600 text-lg font-black shadow-lg shadow-blue-950/30">
                QR
              </div>
              <div>
                <div className="text-3xl font-black leading-none">DALIguro</div>
                <div className="text-sm font-semibold text-blue-100">QR Assessment</div>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto px-4 pb-2">
            {navGroups.map((group) => (
              <div key={group.label}>
                <div className="mb-2 px-3 text-[10px] font-black uppercase tracking-[0.18em] text-blue-200/70">
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.items.map((item, i) => (
                    <SideNavButton
                      key={group.label + item.label + i}
                      item={item}
                      active={item.id === tab}
                      onClick={() => setTab(item.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="space-y-3 p-4">
            <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
              <div className="text-xs font-semibold text-blue-100">Teacher</div>
              <div className="mt-1 text-sm font-black">{active?.teacherName ?? "Teacher Workspace"}</div>
            </div>
            <div className="rounded-2xl bg-white/10 p-4 ring-1 ring-white/10">
              <div className="text-xs font-semibold text-blue-100">Active Class</div>
              <div className="mt-1 text-sm font-black">
                {active ? `${active.gradeLevel} - ${active.section}` : "Select an assessment"}
              </div>
            </div>
            <div className="rounded-2xl bg-emerald-400/10 p-4 text-xs font-semibold text-emerald-100 ring-1 ring-emerald-300/20">
              <div className="font-black text-white">● Offline-first</div>
              Saved securely on this device · {pendingReview} pending review
            </div>
            <button className="w-full rounded-2xl bg-white/10 p-4 text-left text-xs font-bold text-blue-100 ring-1 ring-white/10 hover:bg-white/15">
              ? Need help? View User Guide
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xl font-black text-slate-950">DALIguro</div>
                <div className="text-xs font-semibold text-slate-500">QR Assessment</div>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
                Offline-first
              </span>
            </div>
            <nav className="mt-3 flex gap-1 overflow-x-auto">
              {TABS.map((t) => (
                <MobileNavButton
                  key={t.id}
                  tab={t}
                  active={t.id === tab}
                  pendingReview={t.id === "review" ? pendingReview : 0}
                  onClick={() => setTab(t.id)}
                />
              ))}
            </nav>
          </header>

          <main className="mx-auto max-w-[1540px] p-4 lg:p-6">
            <div className="no-print mb-5 rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-sm lg:px-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h1 className="text-2xl font-black tracking-tight text-slate-950 lg:text-3xl">{currentMeta.title}</h1>
                  <p className="mt-1 text-sm font-semibold text-slate-500">{currentMeta.crumb}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(220px,320px)_160px_150px_auto_auto]">
                  <label className="block">
                    <span className="sr-only">Active Assessment</span>
                    <select
                      value={effectiveActiveId ?? ""}
                      onChange={(e) => setActiveId(e.target.value || null)}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500"
                    >
                      {state.assessments.length === 0 ? <option value="">No assessment</option> : null}
                      {state.assessments.map((a) => (
                        <option key={a.id} value={a.id}>{a.title}</option>
                      ))}
                    </select>
                  </label>
                  <div className="h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                    {active ? active.section : "No class"}
                  </div>
                  <div className="h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                    {active ? active.term + " Term" : "No term"}
                  </div>
                  <button
                    onClick={() => window.print()}
                    className="h-10 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 px-4 text-sm font-black text-white shadow-sm"
                  >
                    Export
                  </button>
                  {active ? (
                    <button
                      onClick={() => setActiveId(null)}
                      className="h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-indigo-700"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            {active ? (
              <div className="no-print mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MiniStatus label="Checked Results" value={String(activeResults.length)} />
                <MiniStatus label="Needs Review" value={String(activeResults.filter((r) => r.reviewStatus === "needs_review").length)} tone="warn" />
                <MiniStatus label="Subject" value={active.subject} />
                <MiniStatus label="Storage" value="Offline-first" tone="good" />
              </div>
            ) : null}

            {renderTab(tab, panelProps)}
          </main>
        </div>
      </div>
    </div>
  );
}

function SideNavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-bold transition " +
        (active ? "bg-gradient-to-r from-sky-500 to-violet-600 text-white shadow-lg shadow-blue-950/25" : "text-blue-100 hover:bg-white/10 hover:text-white")
      }
    >
      <span className="w-6 text-center text-lg">{item.icon}</span>
      <span className="flex-1">{item.label}</span>
      {item.badge ? (
        <span className="rounded-full bg-amber-400 px-2 py-0.5 text-xs font-black text-amber-950">{item.badge}</span>
      ) : null}
    </button>
  );
}

function MiniStatus({ label, value, tone = "info" }: { label: string; value: string; tone?: "info" | "warn" | "good" }) {
  const cls = tone === "good" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-indigo-100 bg-white text-slate-800";
  return (
    <div className={"rounded-2xl border px-4 py-3 shadow-sm " + cls}>
      <div className="text-[11px] font-black uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-lg font-black">{value}</div>
    </div>
  );
}

function MobileNavButton({
  tab,
  active,
  pendingReview,
  onClick,
}: {
  tab: TabDef;
  active: boolean;
  pendingReview: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "relative flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold " +
        (active ? "bg-indigo-700 text-white" : "bg-slate-100 text-slate-600")
      }
    >
      <span>{tab.icon}</span>
      {tab.label}
      {pendingReview > 0 ? (
        <span className="rounded-full bg-amber-400 px-1.5 text-xs font-black text-amber-950">{pendingReview}</span>
      ) : null}
    </button>
  );
}

function renderTab(tab: TabId, panelProps: PanelProps) {
  if (tab === "overview") return <ReportsPanel {...panelProps} />;
  if (tab === "setup") return <SetupPanel {...panelProps} />;
  if (tab === "items") return <ItemsPanel {...panelProps} />;
  if (tab === "learners") return <LearnersPanel {...panelProps} />;
  if (tab === "sheets") return <SheetsPanel {...panelProps} />;
  if (tab === "smartscan") return <CheckPanel {...panelProps} />;
  if (tab === "review") return <ReviewPanel {...panelProps} />;
  if (tab === "results") return <ResultsPanel {...panelProps} />;
  if (tab === "analysis") return <AnalysisPanel {...panelProps} />;
  if (tab === "item-analysis") return <AnalysisPanel {...panelProps} />;
  if (tab === "remediation") return <RemediationPanel {...panelProps} />;
  if (tab === "classes") return <LearnersPanel {...panelProps} />;
  if (tab === "settings") return <SetupPanel {...panelProps} />;
  return <ReportsPanel {...panelProps} />;
}
