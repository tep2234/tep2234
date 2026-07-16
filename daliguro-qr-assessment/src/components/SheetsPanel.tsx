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
  const { state, setState, activeId, setActiveId, navigate } = props;

  return (
    <ActiveGate
      assessments={state.assessments}
      activeId={activeId}
      setActiveId={setActiveId}
      title="QR Answer Sheets"
    >
      {(active) => (
        <SheetGenerator
          active={active}
          state={state}
          setState={setState}
          navigate={navigate}
        />
      )}
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
  setState,
  navigate,
}: {
  active: Assessment;
  state: QrAssessmentState;
  setState: PanelProps["setState"];
  navigate: PanelProps["navigate"];
}) {
  const items: Item[] = state.items.filter((i) => i.assessmentId === active.id);
  const unmappedItems = state.items.filter((i) => i.assessmentId !== active.id);
  const sections = distinctSections(state.learners);

  const [version, setVersion] = useState<TestVersion>(active.versions[0] ?? "A");
  const [sectionFilter, setSectionFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [showPayload, setShowPayload] = useState(false);

  const activeVersion = active.versions.includes(version)
    ? version
    : active.versions[0] ?? "A";

  function attachUnmappedItems() {
    if (unmappedItems.length === 0) return;
    const ok = window.confirm(
      "Attach " +
        unmappedItems.length +
        " item(s) to " +
        active.title +
        "? Use this only when the questions were imported but mapped to the wrong assessment.",
    );
    if (!ok) return;
    setState((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.assessmentId === active.id ? item : { ...item, assessmentId: active.id },
      ),
      answerKeys: mergeAnswerKeysForRemappedItems(prev, active.id),
    }));
  }

  function mergeAnswerKeysForRemappedItems(prev: QrAssessmentState, targetAssessmentId: string) {
    const next = { ...prev.answerKeys };
    const targetKeys = { ...(next[targetAssessmentId] ?? {}) };
    const sourceIds = Array.from(
      new Set(prev.items.filter((item) => item.assessmentId !== targetAssessmentId).map((item) => item.assessmentId)),
    );

    sourceIds.forEach((sourceId) => {
      const sourceKeys = next[sourceId] ?? {};
      active.versions.forEach((versionKey) => {
        targetKeys[versionKey] = {
          ...(sourceKeys[versionKey] ?? {}),
          ...(targetKeys[versionKey] ?? {}),
        };
      });
    });
    next[targetAssessmentId] = targetKeys;
    return next;
  }

  // Guard: this phase needs items and learners.
  if (items.length === 0) {
    return (
      <PanelHeader title="QR Answer Sheets" subtitle={active.title}>
        <PipelineGate
          active={active}
          itemCount={items.length}
          learnerCount={state.learners.length}
          globalItemCount={state.items.length}
          onOpenItems={() => navigate?.("items")}
          onOpenLearners={() => navigate?.("learners")}
          onFixMapping={unmappedItems.length > 0 ? attachUnmappedItems : undefined}
        />
      </PanelHeader>
    );
  }
  if (state.learners.length === 0) {
    return (
      <PanelHeader title="QR Answer Sheets" subtitle={active.title}>
        <PipelineGate
          active={active}
          itemCount={items.length}
          learnerCount={state.learners.length}
          globalItemCount={state.items.length}
          onOpenItems={() => navigate?.("items")}
          onOpenLearners={() => navigate?.("learners")}
        />
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
  const printPairs: Learner[][] = [];
  for (let index = 0; index < chosen.length; index += 2) {
    printPairs.push(chosen.slice(index, index + 2));
  }

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
            Two learner sheets per A4 landscape page. In the print dialog: A4 · Landscape ·
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
      <style media="print">{"@page { size: A4 landscape; margin: 8mm; }"}</style>
      <div className="print-area sheet-print-area mt-4">
        {chosen.length === 0 ? (
          <Empty text="Select learners above to preview their answer sheets." />
        ) : (
          printPairs.map((pair) => (
            <div className="sheet-pair relative mb-6 grid gap-4 lg:grid-cols-2" key={pair[0].id}>
              {pair.map((learner) => (
                <AnswerSheet
                  key={learner.id}
                  assessment={active}
                  learner={learner}
                  items={items}
                  version={activeVersion}
                />
              ))}
              {pair.length === 1 ? <div className="sheet-pair-spacer" aria-hidden="true" /> : null}
              <div className="sheet-pair-divider" aria-hidden="true" />
            </div>
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

function PipelineGate({
  active,
  itemCount,
  learnerCount,
  globalItemCount,
  onOpenItems,
  onOpenLearners,
  onFixMapping,
}: {
  active: Assessment;
  itemCount: number;
  learnerCount: number;
  globalItemCount: number;
  onOpenItems: () => void;
  onOpenLearners: () => void;
  onFixMapping?: () => void;
}) {
  const itemReady = itemCount > 0;
  const learnerReady = learnerCount > 0;
  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-slate-800">
      <div className="text-lg font-extrabold text-amber-900">QR sheets are not ready yet</div>
      <p className="mt-1 text-sm text-amber-900/80">
        Active assessment: <b>{active.title}</b>. QR sheets need both imported questions and learners.
      </p>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <PipelineStep
          label="Questions / items"
          value={itemReady ? itemCount + " item(s) mapped" : "Missing for this assessment"}
          ready={itemReady}
        />
        <PipelineStep
          label="Learners"
          value={learnerReady ? learnerCount + " learner(s) loaded" : "Missing"}
          ready={learnerReady}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {!itemReady ? <Button onClick={onOpenItems}>Open Items / Import Questions</Button> : null}
        {!learnerReady ? <Button variant="ghost" onClick={onOpenLearners}>Open Learners</Button> : null}
        {!itemReady && onFixMapping ? (
          <Button variant="small" onClick={onFixMapping}>
            Fix item mapping ({globalItemCount} found)
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PipelineStep({
  label,
  value,
  ready,
}: {
  label: string;
  value: string;
  ready: boolean;
}) {
  return (
    <div className={"rounded-lg border bg-white p-3 " + (ready ? "border-emerald-200" : "border-amber-200")}>
      <div className="text-xs font-black uppercase tracking-wide text-slate-500">{label}</div>
      <div className={"mt-1 font-extrabold " + (ready ? "text-emerald-700" : "text-amber-800")}>
        {ready ? "Ready: " : "Action needed: "}
        {value}
      </div>
    </div>
  );
}
