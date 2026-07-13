// Printable SmartScan answer sheet for one learner (template v2).
// Renders directly from the canonical OMR template so the printed geometry
// matches the scanner/detector exactly. QR carries identity only.
// The full 80-row grid is always printed; rows beyond the active item count
// are dimmed and ignored by the scanner.

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { Assessment, Item, Learner, TestVersion } from "../lib/types";
import { buildQrPayload, qrText } from "../lib/qr";
import {
  bubbleCenter,
  CHOICES,
  COLUMNS,
  columnHeaderRect,
  columnX,
  GRID,
  GUIDE_PANEL,
  INFO_PANEL,
  MARKER_HOLE,
  MARKER_RECTS,
  MAX_ITEMS,
  META_PANEL,
  numberX,
  omrItemsOf,
  QR_PANEL,
  QR_ZONE,
  rowCenterY,
  SHEET_H,
  SHEET_W,
  VERSION_BUBBLES,
  VERSION_PANEL,
} from "../lib/scanner/omr-template";

const INK = "#0f172a";
const ACCENT = "#4f46e5";
const FAINT = "#94a3b8";

function underline(x: number, y: number, w: number) {
  return <line x1={x} y1={y} x2={x + w} y2={y} stroke="#475569" strokeWidth={1.2} />;
}

// One labelled field: small label, printed value, underline. Long values are
// compressed to the field width (textLength) so they never overflow the panel.
function Field({
  x,
  y,
  w,
  label,
  value,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  value: string;
}) {
  const maxTextW = w - 8;
  // Rough advance at 16px Arial ≈ 8.4px/char; compress only when it overflows.
  const overflows = value.length * 8.4 > maxTextW;
  return (
    <g>
      <text x={x} y={y} fontSize={15} fill={INK}>
        {label}
      </text>
      <text
        x={x + 8}
        y={y + 22}
        fontSize={16}
        fontWeight="bold"
        fill={INK}
        {...(overflows ? { textLength: maxTextW, lengthAdjust: "spacingAndGlyphs" } : {})}
      >
        {value}
      </text>
      {underline(x, y + 27, w)}
    </g>
  );
}

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
  const omr = useMemo(() => omrItemsOf(items), [items]);
  const payloadText = useMemo(
    () => qrText(buildQrPayload(assessment.id, learner, version, omr.length)),
    [assessment.id, learner, version, omr.length],
  );
  const [qrUrl, setQrUrl] = useState("");
  useEffect(() => {
    let on = true;
    QRCode.toDataURL(payloadText, { width: 768, margin: 2, errorCorrectionLevel: "Q" })
      .then((u) => on && setQrUrl(u))
      .catch(() => on && setQrUrl(""));
    return () => {
      on = false;
    };
  }, [payloadText]);

  const manualItems = items
    .filter((i) => !omr.includes(i))
    .sort((a, b) => a.itemNumber - b.itemNumber);

  const choicesFor = (idx: number) =>
    idx < omr.length ? Math.max(2, Math.min(omr[idx].choices, 5)) : CHOICES.length;

  return (
    <div className="sheet mx-auto mb-6 max-w-3xl bg-white">
      <svg
        viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}
        className="block w-full"
        style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
      >
        <rect x={1} y={1} width={SHEET_W - 2} height={SHEET_H - 2} fill="white" stroke="#cbd5e1" />

        {/* Corner alignment markers — solid squares with a white knockout */}
        {MARKER_RECTS.map((m, i) => (
          <g key={i}>
            <rect x={m.x} y={m.y} width={m.w} height={m.h} fill="black" />
            <rect
              x={m.x + (m.w - MARKER_HOLE) / 2}
              y={m.y + (m.h - MARKER_HOLE) / 2}
              width={MARKER_HOLE}
              height={MARKER_HOLE}
              fill="white"
            />
          </g>
        ))}

        {/* Header */}
        <text x={SHEET_W / 2} y={62} textAnchor="middle" fontSize={36} fontWeight="bold" fill={INK}>
          DALIguro SmartScan
        </text>
        <line x1={330} y1={78} x2={455} y2={78} stroke={ACCENT} strokeWidth={2} />
        <text x={500} y={83} textAnchor="middle" fontSize={14} fill={ACCENT}>
          ✦
        </text>
        <line x1={545} y1={78} x2={670} y2={78} stroke={ACCENT} strokeWidth={2} />
        <text x={SHEET_W / 2} y={104} textAnchor="middle" fontSize={20} fontWeight="bold" fill={ACCENT}>
          Answer Sheet
        </text>

        {/* QR panel */}
        <rect x={QR_PANEL.x} y={QR_PANEL.y} width={QR_PANEL.w} height={QR_PANEL.h} rx={8} fill="white" stroke={INK} strokeWidth={1.5} />
        <text x={QR_PANEL.x + QR_PANEL.w / 2} y={QR_PANEL.y + 18} textAnchor="middle" fontSize={12.5} fontWeight="bold" fill={INK}>
          SMARTSCAN QR
        </text>
        {qrUrl ? (
          <image href={qrUrl} x={QR_ZONE.x} y={QR_ZONE.y} width={QR_ZONE.w} height={QR_ZONE.h} />
        ) : (
          <rect x={QR_ZONE.x} y={QR_ZONE.y} width={QR_ZONE.w} height={QR_ZONE.h} fill="#f1f5f9" />
        )}
        <text x={QR_PANEL.x + QR_PANEL.w / 2} y={QR_ZONE.y + QR_ZONE.h + 11} textAnchor="middle" fontSize={10} fill={INK}>
          Scan to check this sheet
        </text>

        {/* Learner info panel */}
        <rect x={INFO_PANEL.x} y={INFO_PANEL.y} width={INFO_PANEL.w} height={INFO_PANEL.h} rx={8} fill="white" stroke={INK} strokeWidth={1.5} />
        <Field x={INFO_PANEL.x + 16} y={INFO_PANEL.y + 30} w={INFO_PANEL.w - 32} label="Learner Name" value={learner.fullName} />
        <Field x={INFO_PANEL.x + 16} y={INFO_PANEL.y + 75} w={INFO_PANEL.w - 32} label="LRN / Student ID" value={learner.lrn || ""} />
        <Field
          x={INFO_PANEL.x + 16}
          y={INFO_PANEL.y + 120}
          w={INFO_PANEL.w - 32}
          label="Grade / Section"
          value={`${learner.gradeLevel || assessment.gradeLevel} — ${learner.section || assessment.section}`}
        />
        <Field x={INFO_PANEL.x + 16} y={INFO_PANEL.y + 165} w={(INFO_PANEL.w - 48) / 2} label="Subject" value={assessment.subject} />
        <Field
          x={INFO_PANEL.x + 32 + (INFO_PANEL.w - 48) / 2}
          y={INFO_PANEL.y + 165}
          w={(INFO_PANEL.w - 48) / 2}
          label="Teacher"
          value={assessment.teacherName}
        />

        {/* Assessment meta panel */}
        <rect x={META_PANEL.x} y={META_PANEL.y} width={META_PANEL.w} height={META_PANEL.h} rx={8} fill="white" stroke={INK} strokeWidth={1.5} />
        <Field x={META_PANEL.x + 14} y={META_PANEL.y + 30} w={META_PANEL.w - 28} label="Assessment Title" value={assessment.title} />
        <text x={META_PANEL.x + 14} y={META_PANEL.y + 90} fontSize={15} fill={INK}>
          Set / Version
        </text>
        <text x={META_PANEL.x + 120} y={META_PANEL.y + 90} fontSize={18} fontWeight="bold" fill={INK}>
          {version}
        </text>
        <text x={META_PANEL.x + 145} y={META_PANEL.y + 90} fontSize={12} fill={FAINT}>
          ( A B C D )
        </text>
        <Field x={META_PANEL.x + 14} y={META_PANEL.y + 118} w={META_PANEL.w - 28} label="Total Items" value={String(omr.length)} />
        <text x={META_PANEL.x + 14} y={META_PANEL.y + 178} fontSize={15} fill={INK}>
          Date
        </text>
        {underline(META_PANEL.x + 14, META_PANEL.y + 205, META_PANEL.w - 28)}
        <text x={META_PANEL.x + 14} y={META_PANEL.y + 222} fontSize={10.5} fill={FAINT}>
          (YYYY-MM-DD)
        </text>

        {/* VERSION shade-one panel (machine-read layer 2, pre-shaded) */}
        <rect x={VERSION_PANEL.x} y={VERSION_PANEL.y} width={VERSION_PANEL.w} height={VERSION_PANEL.h} rx={8} fill="white" stroke={INK} strokeWidth={1.5} />
        <text x={VERSION_PANEL.x + 16} y={VERSION_PANEL.y + 24} fontSize={13} fontWeight="bold" fill={INK}>
          VERSION <tspan fontWeight="normal">(Shade one)</tspan>
        </text>
        {VERSION_BUBBLES.map((b) => (
          <g key={b.version}>
            <text x={b.cx} y={b.cy - 18} textAnchor="middle" fontSize={14} fontWeight="bold" fill={INK}>
              {b.version}
            </text>
            <circle
              cx={b.cx}
              cy={b.cy}
              r={b.r}
              fill={b.version === version ? "black" : "white"}
              stroke="black"
              strokeWidth={2}
            />
          </g>
        ))}

        {/* Usage guide panel */}
        <rect x={GUIDE_PANEL.x} y={GUIDE_PANEL.y} width={GUIDE_PANEL.w} height={GUIDE_PANEL.h} rx={8} fill="white" stroke={INK} strokeWidth={1.5} />
        <circle cx={GUIDE_PANEL.x + 26} cy={GUIDE_PANEL.y + 34} r={9} fill="none" stroke={ACCENT} strokeWidth={1.6} />
        <text x={GUIDE_PANEL.x + 26} y={GUIDE_PANEL.y + 39} textAnchor="middle" fontSize={12} fontWeight="bold" fill={ACCENT}>
          i
        </text>
        <text x={GUIDE_PANEL.x + 44} y={GUIDE_PANEL.y + 28} fontSize={13} fontWeight="bold" fill={INK}>
          This sheet supports variable active item counts.
        </text>
        <text x={GUIDE_PANEL.x + GUIDE_PANEL.w - 16} y={GUIDE_PANEL.y + 28} textAnchor="end" fontSize={12} fontWeight="bold" fill={ACCENT}>
          Typical Usage Guide
        </text>
        <text x={GUIDE_PANEL.x + 44} y={GUIDE_PANEL.y + 47} fontSize={12.5} fill={INK}>
          Shade only the items your test uses — the rest are ignored.
        </text>
        <text x={GUIDE_PANEL.x + 44} y={GUIDE_PANEL.y + 70} fontSize={12} fill={FAINT}>
          Quiz ≤ 20 · Long Test ≤ 40 · Exam ≤ 60 · Extended ≤ 80 items
        </text>

        {/* Column headers + decorative squares */}
        {Array.from({ length: COLUMNS }, (_, col) => {
          const h = columnHeaderRect(col);
          return (
            <g key={col}>
              <rect
                x={columnX(col) + 100}
                y={GRID.top - 58}
                width={12}
                height={12}
                fill="black"
              />
              <rect x={h.x} y={h.y} width={h.w} height={h.h} rx={4} fill="black" />
              {CHOICES.map((c, ci) => (
                <text
                  key={c}
                  x={columnX(col) + 56 + ci * 34}
                  y={h.y + 17}
                  textAnchor="middle"
                  fontSize={14}
                  fontWeight="bold"
                  fill="white"
                >
                  {c}
                </text>
              ))}
              <rect
                x={columnX(col) + 100}
                y={GRID.bottom + 10}
                width={12}
                height={12}
                fill="black"
              />
            </g>
          );
        })}

        {/* Bubble grid — all 80 rows; inactive rows dimmed */}
        {Array.from({ length: MAX_ITEMS }, (_, idx) => {
          const n = idx + 1;
          const active = idx < omr.length;
          const cy = rowCenterY(n);
          const col = Math.floor(idx / 20);
          const nChoices = choicesFor(idx);
          return (
            <g key={n} opacity={active ? 1 : 0.28}>
              <text
                x={numberX(col) + 26}
                y={cy + 5}
                textAnchor="end"
                fontSize={15}
                fontWeight="bold"
                fill={INK}
              >
                {active ? omr[idx].itemNumber : n}
              </text>
              {CHOICES.slice(0, nChoices).map((_, ci) => {
                const p = bubbleCenter(n, ci);
                return (
                  <circle
                    key={ci}
                    cx={p.x}
                    cy={p.y}
                    r={12}
                    fill="white"
                    stroke="black"
                    strokeWidth={1.8}
                  />
                );
              })}
            </g>
          );
        })}

        {/* Teacher / proctor box */}
        <rect x={110} y={1300} width={780} height={44} rx={6} fill="white" stroke={FAINT} strokeWidth={1.2} strokeDasharray="5 4" />
        <text x={SHEET_W / 2} y={1315} textAnchor="middle" fontSize={12} fontWeight="bold" fill={INK}>
          For Teacher / Proctor Use
        </text>
        <text x={126} y={1335} fontSize={11.5} fill={INK}>
          Checked by: ____________________ Date: ____________
        </text>
        <text x={550} y={1335} fontSize={11.5} fill={INK}>
          Remarks: ______________________________
          {manualItems.length > 0
            ? `  ·  Items checked manually: ${manualItems.map((i) => i.itemNumber).join(", ")}`
            : ""}
        </text>

        {/* Scan tips */}
        <rect x={110} y={1352} width={780} height={36} rx={6} fill="white" stroke={INK} strokeWidth={1.2} />
        <text x={SHEET_W / 2} y={1366} textAnchor="middle" fontSize={11.5} fontWeight="bold" fill={INK}>
          SCAN TIPS FOR BEST RESULTS
        </text>
        <text x={SHEET_W / 2} y={1381} textAnchor="middle" fontSize={10.5} fill={INK}>
          ● Shade bubbles completely · ⊘ Avoid stray marks and erasures · ✎ Use a dark pencil or pen · ▤ Keep the sheet flat and clean · ☼ Good lighting improves scans
        </text>

        <text x={SHEET_W / 2} y={1404} textAnchor="middle" fontSize={11.5} fontWeight="bold" fill={ACCENT}>
          ♥ Thank you for doing your best! You've got this!
        </text>
      </svg>
    </div>
  );
}
