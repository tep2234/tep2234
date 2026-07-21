export type CameraLifecycleState =
  | "IDLE"
  | "REQUESTING_PERMISSION"
  | "STARTING"
  | "ACTIVE"
  | "SUSPENDED"
  | "RECOVERING"
  | "STOPPING"
  | "STOPPED"
  | "ERROR";

export type CameraLifecycleOutcome =
  | "request"
  | "started"
  | "active"
  | "page-hidden"
  | "focus-lost"
  | "track-ended"
  | "device-change"
  | "recovering"
  | "permission-denied"
  | "start-failed"
  | "stopping"
  | "stopped"
  | "stale-result";

export interface CameraLifecycleSnapshot {
  state: CameraLifecycleState;
  generation: number;
  wantsCamera: boolean;
  outcome: CameraLifecycleOutcome | null;
}

export type CameraLifecycleReporter = (snapshot: CameraLifecycleSnapshot) => void;

const stoppedTracks = new WeakSet<object>();

export function stopCameraStreamOnce(stream: Pick<MediaStream, "getTracks">): void {
  for (const track of stream.getTracks()) {
    if (stoppedTracks.has(track)) continue;
    stoppedTracks.add(track);
    track.stop();
  }
}

// Pure coordinator for permission/start/recovery races. Browser resources stay
// in the owning component, while this machine is the single authority on
// whether an asynchronous stream result may be accepted.
export class CameraLifecycleMachine {
  private state: CameraLifecycleState = "IDLE";
  private generation = 0;
  private wantsCamera = false;
  private outcome: CameraLifecycleOutcome | null = null;
  private readonly report?: CameraLifecycleReporter;

  constructor(report?: CameraLifecycleReporter) {
    this.report = report;
  }

  snapshot(): CameraLifecycleSnapshot {
    return {
      state: this.state,
      generation: this.generation,
      wantsCamera: this.wantsCamera,
      outcome: this.outcome,
    };
  }

  request(): number {
    this.generation += 1;
    this.wantsCamera = true;
    this.transition("REQUESTING_PERMISSION", "request");
    return this.generation;
  }

  starting(generation: number): boolean {
    if (!this.accepts(generation)) return this.rejectStale();
    this.transition("STARTING", "started");
    return true;
  }

  activate(generation: number): boolean {
    if (!this.accepts(generation)) return this.rejectStale();
    this.transition("ACTIVE", "active");
    return true;
  }

  suspend(outcome: Extract<CameraLifecycleOutcome, "page-hidden" | "focus-lost" | "track-ended" | "device-change">): boolean {
    if (!this.wantsCamera || !["ACTIVE", "STARTING", "REQUESTING_PERMISSION"].includes(this.state)) return false;
    this.generation += 1;
    this.transition("SUSPENDED", outcome);
    return true;
  }

  recover(): number | null {
    if (!this.wantsCamera || this.state !== "SUSPENDED") return null;
    this.generation += 1;
    this.transition("RECOVERING", "recovering");
    return this.generation;
  }

  retryAfterError(): number | null {
    if (!this.wantsCamera || this.state !== "ERROR") return null;
    return this.request();
  }

  fail(generation: number, outcome: Extract<CameraLifecycleOutcome, "permission-denied" | "start-failed">): boolean {
    if (!this.accepts(generation)) return this.rejectStale();
    this.transition("ERROR", outcome);
    return true;
  }

  stop(): number {
    this.generation += 1;
    this.wantsCamera = false;
    this.transition("STOPPING", "stopping");
    return this.generation;
  }

  stopped(generation: number): boolean {
    if (generation !== this.generation) return this.rejectStale();
    this.transition("STOPPED", "stopped");
    return true;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation && this.wantsCamera;
  }

  private accepts(generation: number): boolean {
    return generation === this.generation && this.wantsCamera;
  }

  private rejectStale(): false {
    this.outcome = "stale-result";
    this.report?.(this.snapshot());
    return false;
  }

  private transition(state: CameraLifecycleState, outcome: CameraLifecycleOutcome): void {
    this.state = state;
    this.outcome = outcome;
    this.report?.(this.snapshot());
  }
}
