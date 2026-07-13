// Pure temporal consensus for the phone scanner. Averaging reduces sensor
// noise, while unreadable visual evidence is unioned across the full stable
// burst so denoising can never reclassify an obscured choice as certain.

import type { ScanDetection } from "../sync/pairing";
import { classifyItem } from "./omr-detect";
import { avgConfidence, isDoubtful, scanSignature, type MobileScan } from "./mobile-analyze";
import { CHOICES } from "./omr-template";

export interface FillAccum {
  key: string;
  n: number;
  fills: Map<number, number[]>;
  unreadableChoices: Map<number, Set<number>>;
  base: MobileScan;
}

export function buildConsensusScan(acc: FillAccum): MobileScan {
  const detected: ScanDetection[] = acc.base.detected.map((d) => {
    const summed = acc.fills.get(d.item) ?? d.fill ?? [];
    const avg = summed.map((value) => value / acc.n);
    const reading = classifyItem(d.item, avg, CHOICES.length);
    const unreadableChoices = [...(acc.unreadableChoices.get(d.item) ?? new Set<number>())]
      .sort((left, right) => left - right);
    if (unreadableChoices.length > 0) {
      return {
        item: reading.item,
        answer: reading.detected ?? "",
        status: "unreadable",
        confidence: Math.min(reading.confidence, 0.15),
        fill: reading.fill,
        unreadableChoices,
      };
    }
    return {
      item: reading.item,
      answer: reading.detected ?? "",
      status: reading.status,
      confidence: reading.confidence,
      fill: reading.fill,
    };
  });
  const confidence = avgConfidence(detected);
  const hasUnreadable = detected.some((item) => item.status === "unreadable");
  const quality = hasUnreadable
    ? {
        ...acc.base.quality,
        label: "Review" as const,
        disposition: "review" as const,
        autoEligible: false,
        issues: Array.from(new Set(acc.base.quality.issues.concat("unreadable bubble region"))),
        reasonCodes: Array.from(new Set(acc.base.quality.reasonCodes.concat("BUBBLE_REGION_UNREADABLE" as const))),
      }
    : acc.base.quality;
  return {
    ...acc.base,
    detected,
    confidence,
    quality,
    hasDoubt: detected.some(isDoubtful),
    reviewCount: detected.filter(isDoubtful).length,
    signature: scanSignature(acc.base.learnerId, acc.base.version, detected),
  };
}
