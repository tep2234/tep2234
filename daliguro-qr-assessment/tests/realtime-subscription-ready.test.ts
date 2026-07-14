import { beforeEach, describe, expect, it, vi } from "vitest";

const realtime = vi.hoisted(() => {
  const channel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channel.on.mockReturnValue(channel);
  const client = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
  };
  return { channel, client };
});

vi.mock("../src/lib/supabase/client", () => ({
  getSupabaseClient: () => realtime.client,
}));

import { subscribePhoneSubmissions } from "../src/lib/sync/realtimeSmartScan";

describe("phone inbox Realtime readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtime.channel.on.mockReturnValue(realtime.channel);
  });

  it("requests authoritative reconciliation only after the channel subscribes", () => {
    let reportStatus: ((status: string) => void) | undefined;
    realtime.channel.subscribe.mockImplementation((callback: (status: string) => void) => {
      reportStatus = callback;
      return realtime.channel;
    });
    const onSubscribed = vi.fn();

    const unsubscribe = subscribePhoneSubmissions(
      "teacher-1",
      "assessment-1",
      vi.fn(),
      onSubscribed,
    );

    expect(onSubscribed).not.toHaveBeenCalled();
    reportStatus?.("JOINING");
    expect(onSubscribed).not.toHaveBeenCalled();
    reportStatus?.("SUBSCRIBED");
    expect(onSubscribed).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(realtime.client.removeChannel).toHaveBeenCalledWith(realtime.channel);
  });
});
