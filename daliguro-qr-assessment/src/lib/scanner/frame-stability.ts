import type { Point } from "./omr-template";

export interface NormalizedSheetGeometry {
  corners: [Point, Point, Point, Point];
  area: number;
  rotation: number;
}

export interface FrameStabilityState {
  identity: string;
  // Anchor values stay fixed for the whole sequence so slow cumulative motion
  // cannot pass merely because each individual step is small.
  geometry: NormalizedSheetGeometry;
  lastGeometry: NormalizedSheetGeometry;
  luminance: number;
  sharpness: number;
  lastLuminance: number;
  lastSharpness: number;
  lastObservedAt: number;
  consecutive: number;
}

export interface FrameStabilityObservation {
  identity: string;
  geometry: NormalizedSheetGeometry;
  luminance: number;
  sharpness: number;
  observedAt: number;
  // A sticky/cached QR is useful for instructions, but it is not identity
  // evidence for an automatic capture decision.
  freshIdentity: boolean;
}

export interface FrameStabilityDecision {
  state: FrameStabilityState | null;
  ready: boolean;
  resetReason: "identity_missing" | "identity_changed" | "motion" | "quality_changed" | "timeout" | null;
}

export const REQUIRED_STABLE_FRAMES = 4;
export const MAX_CORNER_DRIFT = 0.018;
export const MAX_AREA_CHANGE = 0.07;
export const MAX_ROTATION_CHANGE_DEGREES = 2;
export const MAX_LUMINANCE_CHANGE = 18;
export const MAX_SHARPNESS_CHANGE_RATIO = 0.4;
export const MAX_FRAME_GAP_MS = 1200;

function polygonArea(points: Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
}

export function normalizedSheetGeometry(
  corners: Point[] | null,
  width: number,
  height: number,
): NormalizedSheetGeometry | null {
  if (!corners || corners.length !== 4 || width <= 0 || height <= 0) return null;
  const normalized = corners.map((corner) => ({
    x: corner.x / width,
    y: corner.y / height,
  })) as [Point, Point, Point, Point];
  if (normalized.some((corner) => !Number.isFinite(corner.x) || !Number.isFinite(corner.y))) return null;
  const [topLeft, topRight] = normalized;
  return {
    corners: normalized,
    area: polygonArea(normalized),
    rotation: Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x) * 180 / Math.PI,
  };
}

function angleDifference(left: number, right: number): number {
  const delta = Math.abs(left - right) % 360;
  return Math.min(delta, 360 - delta);
}

export function isSheetGeometryStable(
  previous: NormalizedSheetGeometry,
  next: NormalizedSheetGeometry,
): boolean {
  const maximumDrift = Math.max(
    ...previous.corners.map((corner, index) =>
      Math.hypot(corner.x - next.corners[index].x, corner.y - next.corners[index].y),
    ),
  );
  const areaChange = Math.abs(next.area - previous.area) / Math.max(previous.area, 0.0001);
  return (
    maximumDrift <= MAX_CORNER_DRIFT &&
    areaChange <= MAX_AREA_CHANGE &&
    angleDifference(previous.rotation, next.rotation) <= MAX_ROTATION_CHANGE_DEGREES
  );
}

export function advanceFrameStability(
  previous: FrameStabilityState | null,
  observation: FrameStabilityObservation | null,
  requiredFrames = REQUIRED_STABLE_FRAMES,
): FrameStabilityDecision {
  if (!observation?.freshIdentity || !observation.identity) {
    return { state: null, ready: false, resetReason: "identity_missing" };
  }
  if (!previous || previous.identity !== observation.identity) {
    const state = {
      identity: observation.identity,
      geometry: observation.geometry,
      lastGeometry: observation.geometry,
      luminance: observation.luminance,
      sharpness: observation.sharpness,
      lastLuminance: observation.luminance,
      lastSharpness: observation.sharpness,
      lastObservedAt: observation.observedAt,
      consecutive: 1,
    };
    return {
      state,
      ready: requiredFrames <= 1,
      resetReason: previous ? "identity_changed" : null,
    };
  }
  if (
    !Number.isFinite(observation.observedAt) ||
    observation.observedAt <= previous.lastObservedAt ||
    observation.observedAt - previous.lastObservedAt > MAX_FRAME_GAP_MS
  ) {
    return {
      state: {
        identity: observation.identity,
        geometry: observation.geometry,
        lastGeometry: observation.geometry,
        luminance: observation.luminance,
        sharpness: observation.sharpness,
        lastLuminance: observation.luminance,
        lastSharpness: observation.sharpness,
        lastObservedAt: observation.observedAt,
        consecutive: 1,
      },
      ready: requiredFrames <= 1,
      resetReason: "timeout",
    };
  }
  const luminanceStable =
    Number.isFinite(observation.luminance) &&
    Math.abs(previous.luminance - observation.luminance) <= MAX_LUMINANCE_CHANGE &&
    Math.abs(previous.lastLuminance - observation.luminance) <= MAX_LUMINANCE_CHANGE;
  const sharpnessStable =
    Number.isFinite(observation.sharpness) &&
    Math.abs(previous.sharpness - observation.sharpness) /
      Math.max(previous.sharpness, observation.sharpness, 0.1) <= MAX_SHARPNESS_CHANGE_RATIO &&
    Math.abs(previous.lastSharpness - observation.sharpness) /
      Math.max(previous.lastSharpness, observation.sharpness, 0.1) <= MAX_SHARPNESS_CHANGE_RATIO;
  const geometryStable =
    isSheetGeometryStable(previous.geometry, observation.geometry) &&
    isSheetGeometryStable(previous.lastGeometry, observation.geometry);
  if (!geometryStable || !luminanceStable || !sharpnessStable) {
    return {
      state: {
        identity: observation.identity,
        geometry: observation.geometry,
        lastGeometry: observation.geometry,
        luminance: observation.luminance,
        sharpness: observation.sharpness,
        lastLuminance: observation.luminance,
        lastSharpness: observation.sharpness,
        lastObservedAt: observation.observedAt,
        consecutive: 1,
      },
      ready: requiredFrames <= 1,
      resetReason: geometryStable ? "quality_changed" : "motion",
    };
  }
  const state = {
    identity: observation.identity,
    geometry: previous.geometry,
    lastGeometry: observation.geometry,
    luminance: previous.luminance,
    sharpness: previous.sharpness,
    lastLuminance: observation.luminance,
    lastSharpness: observation.sharpness,
    lastObservedAt: observation.observedAt,
    consecutive: previous.consecutive + 1,
  };
  return { state, ready: state.consecutive >= requiredFrames, resetReason: null };
}
