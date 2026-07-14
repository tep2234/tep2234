import { describe, expect, it, vi } from "vitest";
import { CameraLifecycleMachine, stopCameraStreamOnce } from "../src/lib/scanner/camera-lifecycle";

describe("camera lifecycle state machine", () => {
  it("moves through permission, startup, active, stop, and stopped", () => {
    const machine = new CameraLifecycleMachine();
    const generation = machine.request();
    expect(machine.snapshot().state).toBe("REQUESTING_PERMISSION");
    expect(machine.starting(generation)).toBe(true);
    expect(machine.snapshot().state).toBe("STARTING");
    expect(machine.activate(generation)).toBe(true);
    expect(machine.snapshot().state).toBe("ACTIVE");
    const stoppedGeneration = machine.stop();
    expect(machine.snapshot().state).toBe("STOPPING");
    expect(machine.stopped(stoppedGeneration)).toBe(true);
    expect(machine.snapshot()).toMatchObject({ state: "STOPPED", wantsCamera: false });
  });

  it.each([
    "page-hidden",
    "focus-lost",
    "track-ended",
    "device-change",
  ] as const)("suspends and recovers after %s", (outcome) => {
    const machine = new CameraLifecycleMachine();
    const initial = machine.request();
    machine.starting(initial);
    machine.activate(initial);
    expect(machine.suspend(outcome)).toBe(true);
    expect(machine.snapshot()).toMatchObject({ state: "SUSPENDED", outcome, wantsCamera: true });
    const recovery = machine.recover();
    expect(recovery).not.toBeNull();
    expect(machine.snapshot().state).toBe("RECOVERING");
    expect(machine.starting(recovery!)).toBe(true);
    expect(machine.activate(recovery!)).toBe(true);
  });

  it("allows permission retry after a previous denial", () => {
    const machine = new CameraLifecycleMachine();
    const denied = machine.request();
    expect(machine.fail(denied, "permission-denied")).toBe(true);
    expect(machine.snapshot().state).toBe("ERROR");
    const retry = machine.retryAfterError();
    expect(retry).not.toBeNull();
    expect(machine.snapshot().state).toBe("REQUESTING_PERMISSION");
  });

  it("rejects stale stream results after a newer request", () => {
    const report = vi.fn();
    const machine = new CameraLifecycleMachine(report);
    const first = machine.request();
    const second = machine.request();
    expect(machine.starting(first)).toBe(false);
    expect(machine.activate(first)).toBe(false);
    expect(machine.starting(second)).toBe(true);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ outcome: "stale-result" }));
  });

  it("prevents duplicate recovery generations", () => {
    const machine = new CameraLifecycleMachine();
    const current = machine.request();
    machine.starting(current);
    machine.activate(current);
    machine.suspend("track-ended");
    expect(machine.recover()).not.toBeNull();
    expect(machine.recover()).toBeNull();
  });

  it("invalidates permission and stream callbacks on route change or unmount", () => {
    const machine = new CameraLifecycleMachine();
    const pending = machine.request();
    const stoppedGeneration = machine.stop();
    expect(machine.starting(pending)).toBe(false);
    expect(machine.activate(pending)).toBe(false);
    expect(machine.stopped(stoppedGeneration)).toBe(true);
    expect(machine.snapshot()).toMatchObject({ state: "STOPPED", wantsCamera: false });
  });

  it("invalidates a permission request when the page is hidden", () => {
    const machine = new CameraLifecycleMachine();
    const pending = machine.request();
    expect(machine.suspend("page-hidden")).toBe(true);
    expect(machine.starting(pending)).toBe(false);
    const recovery = machine.recover();
    expect(recovery).not.toBeNull();
  });

  it("supports repeated scan sessions without accepting an earlier stream", () => {
    const machine = new CameraLifecycleMachine();
    const first = machine.request();
    machine.starting(first);
    machine.activate(first);
    const stopped = machine.stop();
    machine.stopped(stopped);
    const second = machine.request();
    expect(machine.activate(first)).toBe(false);
    expect(machine.starting(second)).toBe(true);
    expect(machine.activate(second)).toBe(true);
  });

  it("rapid gallery switching invalidates recovery and prevents stale activation", () => {
    const machine = new CameraLifecycleMachine();
    const active = machine.request();
    machine.starting(active);
    machine.activate(active);
    machine.suspend("page-hidden");
    const recovery = machine.recover()!;
    const stoppedGeneration = machine.stop();
    expect(machine.activate(recovery)).toBe(false);
    expect(machine.stopped(stoppedGeneration)).toBe(true);
  });

  it("stops every acquired track exactly once across repeated cleanup", () => {
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    const tracks = [
      { stop: firstStop },
      { stop: secondStop },
    ];
    const stream = {
      getTracks: () => tracks,
    } as unknown as Pick<MediaStream, "getTracks">;
    stopCameraStreamOnce(stream);
    stopCameraStreamOnce(stream);
    expect(firstStop).toHaveBeenCalledTimes(1);
    expect(secondStop).toHaveBeenCalledTimes(1);
  });
});
