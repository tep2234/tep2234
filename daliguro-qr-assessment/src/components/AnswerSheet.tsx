// Phase 12 — printable OMR answer sheet for one learner.
// Renders directly from the canonical OMR template so the printed geometry
// matches the scanner/detector exactly. QR carries identity only.

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { Assessment, Item, Learner, TestVersion } from "../lib/types";
import { buildQrPayload, qrText } from "../lib/qr";
import {
  buildTemplate,
  columnFor,
  numberX,
  omrItemsOf,
  rowCenterY,
  type OmrTemplate,
} from "../lib/scanner/omr-template";

const CHOICE_LETTERS = ["A", "B", "C", "D"];

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
  const payloadText = useMemo(
    () => qrText(buildQrPayload(assessment.id, learner, version)),
    [assessment.id, learner, version],
  );
  const [qrUrl, setQrUrl] = useState("");
  useEffect(() => {
    let on = true;
    QRCode.toDataURL(payloadText, { width: 252, margin: 1, errorCorrectionLevel: "M" })
      .then((u) => on && setQrUrl(u))
      .catch(() => on && setQrUrl(""));
    return () => {
      on = false;
    };
  }, [payloadText]);

  const omr = useMemo(() => omrItemsOf(items), [items]);
  const template = useMemo<OmrTemplate>(() => buildTemplate(Math.max(1, omr.length)), [omr.length]);
  const manualItems = items
    .filter((i) => !omr.includes(i))
    .sort((a, b) => a.itemNumber - b.itemNumber);

  return (
    <div className="sheet mx-auto mb-6 max-w-3xl bg-white">
      <svg
        viewBox={`0 0 ${template.width} ${template.height}`}
        className="block w-full"
        style={{ fontFamily: "Arial, sans-serif" }}
      >
        <rect x={1} y={1} width={template.width - 2} height={template.height - 2} fill="white" stroke="#bbb" />

        {/* Corner alignment markers */}
        {template.markerRects.map((m, i) => (
          <rect key={i} x={m.x} y={m.y} width={m.w} height={m.h} fill="black" />
        ))}

        {/* Header */}
        <text x={template.width / 2} y={124} textAnchor="middle" fontSize={30} fontWeight="bold">
          {assessment.title}
        </text>
        <text x={template.width / 2} y={146} textAnchor="middle" fontSize={18} fill="#444">
          {assessment.subject} · {assessment.component} · DALIguro QR Assessment
        </text>

        {/* QR (identity only) */}
        {qrUrl ? (
          <image href={qrUrl} x={template.qrZone.x} y={template.qrZone.y} width={template.qrZone.w} height={template.qrZone.h} />
        ) : (
          <rect x={template.qrZone.x} y={template.qrZone.y} width={template.qrZone.w} height={template.qrZone.h} fill="#eee" />
        )}
        <text x={template.width / 2} y={template.qrZone.y + template.qrZone.h + 22} textAnchor="middle" fontSize={16} fill="#444">
          QR identifies the learner only — no answers inside.
        </text>

        {/* Learner block (fixed, non-overlapping rows below the QR) */}
        <text x={40} y={template.qrZone.y + template.qrZone.h + 50} fontSize={22} fontWeight="bold">
          {learner.fullName}
        </text>
        <text x={40} y={template.qrZone.y + template.qrZone.h + 76} fontSize={17} fill="#222">
          {`LRN: ${learner.lrn || "____________"}    Section: ${learner.section || assessment.section}    Version: ${version}`}
        </text>

        {/* Shading instruction */}
        <text x={40} y={template.qrZone.y + template.qrZone.h + 104} fontSize={17} fontWeight="bold" fill="#000">
          Use black pen or pencil. Shade ONE circle per item clearly.
        </text>

        {/* Bubble grid */}
        {omr.map((item, idx) => {
          const row = idx + 1; // template row number
          const col = columnFor(row);
          const cy = rowCenterY(row);
          const nx = numberX(col, template.columns);
          const choices = Math.max(2, Math.min(item.choices, 4));
          const bubbles = template.bubbles.filter((b) => b.item === row && b.choiceIndex < choices);
          return (
            <g key={item.id}>
              <text x={nx} y={cy + 6} fontSize={20} fontWeight="bold">
                {item.itemNumber}
              </text>
              {bubbles.map((b) => (
                <g key={b.choiceIndex}>
                  <circle cx={b.cx} cy={b.cy} r={b.r} fill="white" stroke="black" strokeWidth={2} />
                  <text x={b.cx} y={b.cy + 5} textAnchor="middle" fontSize={13} fill="#333">
                    {CHOICE_LETTERS[b.choiceIndex]}
                  </text>
                </g>
              ))}
            </g>
          );
        })}

        {/* Footer / scanning guide */}
        <text x={40} y={template.height - 40} fontSize={15} fill="#444">
          Teacher: scan with the DALIguro app (Check → Scan Answer Sheet). Keep all four black corner squares visible and the sheet flat.
        </text>
        <text x={40} y={template.height - 18} fontSize={13} fill="#777">
          {`Assessment ${assessment.id} · Learner ${learner.id} · Version ${version}`}
          {manualItems.length > 0
            ? ` · Items checked manually: ${manualItems.map((i) => i.itemNumber).join(", ")}`
            : ""}
        </text>
      </svg>
    </div>
  );
}
