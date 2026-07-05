// Phase 7 — QR Answer Sheet generator.
// Read-only: selects learners and renders printable QR-coded answer sheets.

import { useState } from "react";
import type { PanelProps } from "./panel-types";
import type {
  Assessment,
  Item,
  Learner,
  QrAssessmentState,
  TestVersion,
} from "../lib/types";
import { buildQrPayload } from "../lib/qr";
import { omrItemsOf } from "../lib/scanner/omr-template";
import { ActiveGate } from "./ActiveGate";
import { AnswerSheet } from "./AnswerSheet";
import { Button, Empty } from "./ui";

export default function SheetsPanel(props: PanelProps) {
  const { state, setState, activeId, setActiveId } = props;

  return (
    <ActiveGate
      assessments={state.assessments}
      activeId={activeId}
      setActiveId={setActiveId}
      title="QR Answer Sheets"
    >
      {(active) => <SheetGenerator active={active} state={state} setState={setState} />}
    </ActiveGate>
  );
}

function distinctSections(learners: Learner[]): string[] {
  const set = new Set<string>();
  learners.forEach((l) => {
    if (l.section.trim()) set.add(l.section.trim());
  });
  return Array.from(set).sort();
}

function SheetGenerator({
  active,
  state,
}: {
  active: Assessment;
  state: QrAssessmentState;
  setState: PanelProps["setState"];
}) {
  const items: Item[] = state.items.filter((i) => i.assessmentId === active.id);
  const sections = distinctSections(state.learners);

  const [version, setVersion] = useState<TestVersion>(active.versions[0] ?? "A");
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [showPayload, setShowPayload] = useState(false);

  const activeVersion = active.versions.includes(version)
    ? version
    : active.versions[0] ?? "A";

  // Guard: this phase needs items and learners.
  if (items.length === 0) {
    return (
      <PanelHeader title="QR Answer Sheets" subtitle={active.title}>
        <Empty text="This assessment has no items. Add items in the Items tab first." />
      </PanelHeader>
    );
  }
  if (state.learners.length === 0) {
    return (
      <PanelHeader title="QR Answer Sheets" subtitle={active.title}>
        <Empty text="No learners yet. Add learners in the Learners tab first." />
      </PanelHeader>
    );
  }

  const q = query.trim().toLowerCase();
  const filtered = state.learners.filter((l) => {
    const okSection = sectionFilter === "all" || l.section === sectionFilter;
    const okQuery =
      q === "" ||
      l.fullName.toLowerCase().includes(q) ||
      l.lrn.toLowerCase().includes(q);
    return okSection && okQuery;
  });

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.concat(id),
    );
  }
  function selectAllFiltered() {
    setSelected(filtered.map((l) => l.id));
  }
  function clearSelection() {
    setSelected([]);
  }

  const chosen = filtered.filter((l) => selected.includes(l.id));

  function printSheets() {
    if (chosen.length === 0) {
      window.alert("Select at least one learner to print.");
      return;
    }
    // Let any just-rendered QR images/SVG settle for a paint before printing,
    // so the print snapshot never captures an unrendered QR placeholder.
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  return (
    <section>
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-extrabold">QR Answer Sheets</h1>
          <p className="mt-1 text-slate-500">
            {active.title} · {items.length} item(s) · {chosen.length} selected
          </p>
        </div>
        <div className="text-right">
          <Button onClick={printSheets}>🖨 Print Selected ({chosen.length})</Button>
          <p className="mt-1 text-xs text-slate-400">
            Each sheet fits one A4 page at 100%. In the print dialog: A4 · Portrait ·
            Scale 100% · Headers/footers off (or “Save as PDF”).
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="no-print mt-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <span className="mb-1 block text-xs font-bold text-slate-500">
              Version
            </span>
            <div className="flex gap-2">
              {active.versions.map((v) => {
                const on = v === activeVersion;
                const cls = on
                  ? "border-indigo-700 bg-indigo-700 text-white"
                  : "border-slate-200 bg-white text-slate-500";
                return (
                  <button
                    key={v}
                    onClick={() => setVersion(v)}
                    className={
                      "h-10 w-10 rounded-lg border text-base font-extrabold " + cls
                    }
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <span className="mb-1 block text-xs font-bold text-slate-500">
              Section
            </span>
            <select
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="all">All sections</option>
              {sections.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-48 flex-1">
            <span className="mb-1 block text-xs font-bold text-slate-500">
              Search name or LRN
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </div>

          <div className="flex gap-2">
            <Button variant="small" onClick={selectAllFiltered}>
              Select all ({filtered.length})
            </Button>
            <Button variant="small" onClick={clearSelection}>
              Clear
            </Button>
          </div>
        </div>

        <div className="mt-3 text-xs text-slate-500">
          🔐 QR encodes identity only: assessment ID, learner ID, LRN, section,
          grade, version, security token. <b>No answer key inside the QR.</b> The
          printed OMR sheet has four black corner markers and A–D bubbles —
          learners shade with black pen/pencil; scan it in Check → Scan Answer
          Sheet to auto-read and score.
        </div>

        {/* Learner picker */}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {filtered.map((l) => {
            const on = selected.includes(l.id);
            const cls = on
              ? "border-indigo-600 bg-indigo-50"
              : "border-slate-200 bg-white";
            return (
              <label
                key={l.id}
                className={"flex items-center gap-2 rounded-lg border px-2 py-1.5 " + cls}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(l.id)} />
                <span className="truncate text-sm">{l.fullName}</span>
              </label>
            );
          })}
        </div>

        {/* Debug payload preview (never shows answer keys) */}
        <div className="mt-3">
          <button
            className="text-xs font-bold text-indigo-700"
            onClick={() => setShowPayload((p) => !p)}
          >
            {showPayload ? "Hide" : "Show"} QR payload preview (debug)
          </button>
          {showPayload && chosen.length > 0 ? (
            <pre className="mt-2 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] text-emerald-300">
              {JSON.stringify(
                buildQrPayload(active.id, chosen[0], activeVersion, omrItemsOf(items).length),
                null,
                2,
              )}
            </pre>
          ) : null}
        </div>
      </div>

      {/* Printable sheets */}
      <div className="print-area mt-4">
        {chosen.length === 0 ? (
          <Empty text="Select learners above to preview their answer sheets." />
        ) : (
          chosen.map((l) => (
            <AnswerSheet
              key={l.id}
              assessment={active}
              learner={l}
              items={items}
              version={activeVersion}
            />
          ))
        )}
      </div>
    </section>
  );
}

function PanelHeader({
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
