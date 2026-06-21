// Phase 7 — printable answer sheet for one learner.
// Read-only: builds a QR identity payload and renders answer fields by type.

import { useMemo } from "react";
import type { Assessment, Item, ItemType, Learner, TestVersion } from "../lib/types";
import { optionPairs, optionSet } from "../lib/items";
import { buildQrPayload, qrText } from "../lib/qr";
import { QrImage } from "./QrImage";

export function AnswerSheet({
  assessment,
  learner,
  items,
  version,
}: {
  assessment: Assessment;
  learner: Learner;
  items: Item[];
  version: TestVersion;
}) {
  // Build the identity payload once per learner+version instance.
  const payloadText = useMemo(
    () => qrText(buildQrPayload(assessment.id, learner, version)),
    [assessment.id, learner, version],
  );

  const ordered = [...items].sort((a, b) => a.itemNumber - b.itemNumber);

  return (
    <div className="sheet relative mx-auto mb-4 max-w-3xl border border-slate-300 bg-white p-6 shadow">
      {/* Alignment markers */}
      <Corner className="left-2 top-2" />
      <Corner className="right-2 top-2" />
      <Corner className="bottom-2 left-2" />
      <Corner className="bottom-2 right-2" />

      {/* Header */}
      <div className="flex justify-between gap-4 border-b-2 border-black pb-2">
        <div>
          <div className="text-[11px] font-bold tracking-wide text-slate-600">
            DALIguro QR Assessment
          </div>
          <div className="text-base font-extrabold">{assessment.title}</div>
          <div className="text-xs">
            {assessment.subject} · Grade {learner.gradeLevel}-
            {learner.section || assessment.section}
          </div>
          <div className="text-xs">
            {assessment.schoolYear} · {assessment.term} Term ·{" "}
            {assessment.component}
          </div>
          <div className="text-xs">Teacher: {assessment.teacherName || "—"}</div>
          <div className="mt-1 inline-block border-2 border-black px-2 text-sm font-extrabold">
            VERSION {version}
          </div>
        </div>
        <div className="text-center">
          <QrImage text={payloadText} size={96} />
          <div className="mt-1 text-[8px]">Scan to identify</div>
        </div>
      </div>

      {/* Learner block */}
      <div className="mt-2 grid grid-cols-2 gap-x-6 text-xs">
        <div>
          <b>Name:</b> {learner.fullName}
        </div>
        <div>
          <b>LRN:</b> {learner.lrn || "____________"}
        </div>
        <div>
          <b>Sex:</b> {learner.sex}
        </div>
        <div>
          <b>Section:</b> {learner.section || assessment.section}
        </div>
      </div>

      {/* Student instruction */}
      <div className="mt-2 rounded border border-black/40 bg-slate-50 px-2 py-1 text-[10px] font-semibold">
        Shade or mark only one answer per item unless instructed. Write clearly
        inside the answer space provided. Use dark marks. Do not shade outside
        answer boxes.
      </div>

      {/* Answer area */}
      <div className="mt-3">
        {ordered.map((item) => (
          <AnswerSlot key={item.id} item={item} />
        ))}
      </div>

      {/* Footer */}
      <div className="mt-4 border-t border-black pt-1 text-[9px] text-slate-600">
        <div className="flex justify-between">
          <span>Assessment ID: {assessment.id}</span>
          <span>Learner ID: {learner.id}</span>
          <span>Version: {version}</span>
        </div>
        <div className="mt-0.5 font-semibold">
          Teacher note: the QR identifies the learner and assessment only.
          Answer key is stored securely in the app.
        </div>
      </div>
    </div>
  );
}

function Corner({ className }: { className: string }) {
  return <div className={"absolute h-3 w-3 bg-black " + className} />;
}

function AnswerSlot({ item }: { item: Item }) {
  return (
    <div
      className="border-t border-dashed border-slate-300 py-1.5"
      style={{ breakInside: "avoid", pageBreakInside: "avoid" }}
    >
      <div className="text-xs font-semibold">
        {item.itemNumber}. <span className="font-normal">{slotLabel(item.type)}</span>{" "}
        <span className="text-slate-500">({item.points} pt)</span>
      </div>
      {item.question ? (
        <div className="text-[11px] text-slate-600">{item.question}</div>
      ) : null}
      <AnswerField item={item} />
    </div>
  );
}

function slotLabel(type: ItemType): string {
  return type;
}

function AnswerField({ item }: { item: Item }) {
  const options = optionSet(item);

  // Objective with fixed options → bubbles, with option text when available.
  if (options) {
    const pairs = optionPairs(item);
    const hasText = pairs.some((p) => p.text.trim());
    if (hasText) {
      return (
        <div className="mt-1 grid gap-0.5">
          {pairs.map((p) => (
            <span key={p.letter} className="flex items-center gap-1.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-black text-[10px]">
                {p.letter}
              </span>
              <span className="text-[11px]">{p.text || "—"}</span>
            </span>
          ))}
        </div>
      );
    }
    return (
      <div className="mt-1 flex flex-wrap gap-3">
        {options.map((opt) => (
          <span key={opt} className="flex items-center gap-1">
            <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-black text-[10px]">
              {opt}
            </span>
          </span>
        ))}
      </div>
    );
  }

  // Subjective / free-text fields by type.
  if (item.type === "Essay") {
    return <WriteBox height={90} note="Rubric / manual scoring" />;
  }
  if (item.type === "Performance Task" || item.type === "Oral Assessment") {
    return <WriteBox height={60} note="Rubric / manual scoring" />;
  }
  if (item.type === "Problem Solving") {
    return (
      <div>
        <WriteBox height={60} note="Solution" />
        <AnswerLine label="Final answer" />
      </div>
    );
  }
  // Sequencing, Identification, Fill in the Blank, Short Answer → a line.
  return <AnswerLine label="Answer" />;
}

function AnswerLine({ label }: { label: string }) {
  return (
    <div className="mt-2 flex items-end gap-2">
      <span className="text-[9px] text-slate-500">{label}:</span>
      <span className="h-4 flex-1 border-b border-black" />
    </div>
  );
}

function WriteBox({ height, note }: { height: number; note: string }) {
  return (
    <div className="mt-1">
      <div className="text-[9px] text-slate-500">{note}</div>
      <div
        style={{ height }}
        className="mt-0.5 w-full border border-black"
      />
    </div>
  );
}
