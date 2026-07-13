import { beforeEach, describe, expect, it } from "vitest";
import type { ScanBroadcast } from "../src/lib/sync/pairing";
import {
  buildPhoneSubmissionEnvelope,
  capabilityStorageKey,
  loadPhoneCapability,
  phonePayloadText,
  savePhoneCapability,
  stripPairingSecretFromUrl,
  type PhoneCapability,
} from "../src/lib/sync/realtime-security";

const capability: PhoneCapability = {
  sessionId: "session-0001",
  capability: "a".repeat(64),
  capabilityExpiresAtMs: Date.now() + 60_000,
  assessmentId: "assessment-1",
  schoolId: "11111111-1111-4111-8111-111111111111",
  itemCount: 1,
  allowedVersions: ["A"],
  nextSequence: 1,
};

const scan: ScanBroadcast = {
  scanId: "scan-id-0001",
  sessionId: capability.sessionId,
  assessmentId: capability.assessmentId,
  learnerId: "learner-1",
  version: "A",
  answerMap: { "1": "B" },
  detected: [{ item: 1, answer: "B", status: "selected", confidence: 0.95 }],
  confidence: 0.95,
  capturedAt: Date.now(),
  deviceName: "Test phone",
};

describe("SmartScan secured Realtime envelope", () => {
  beforeEach(() => sessionStorage.clear());

  it("binds the exact payload bytes to a SHA-256 digest", async () => {
    const envelope = await buildPhoneSubmissionEnvelope({ capability, scan, sequenceNumber: 1 });
    expect(envelope.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
    const tampered = phonePayloadText({ ...scan, learnerId: "other-learner" });
    expect(tampered).not.toBe(envelope.payloadText);
    const tamperedEnvelope = await buildPhoneSubmissionEnvelope({
      capability,
      scan: { ...scan, learnerId: "other-learner" },
      sequenceNumber: 1,
    });
    expect(tamperedEnvelope.payloadDigest).not.toBe(envelope.payloadDigest);
  });

  it("keeps pairing tokens and capabilities out of the persisted scan payload", async () => {
    const envelope = await buildPhoneSubmissionEnvelope({ capability, scan, sequenceNumber: 1 });
    expect(envelope.payloadText).not.toContain(capability.capability);
    expect(envelope.payloadText.toLowerCase()).not.toContain("token");
    expect(JSON.parse(envelope.payloadText)).not.toHaveProperty("capability");
  });

  it("stores only the scoped capability in sessionStorage and expires it locally", () => {
    savePhoneCapability(sessionStorage, capability);
    expect(loadPhoneCapability(sessionStorage, capability.sessionId)).toEqual(capability);
    expect(sessionStorage.getItem(capabilityStorageKey(capability.sessionId))).not.toContain("pairing-token");
    expect(loadPhoneCapability(sessionStorage, capability.sessionId, capability.capabilityExpiresAtMs)).toBeNull();
  });

  it("removes the one-time pairing secret and query string after claim", () => {
    window.history.replaceState(null, "", "/smartscan/mobile/session-0001?t=raw-secret&a=untrusted#camera");
    stripPairingSecretFromUrl(window.location, window.history);
    expect(window.location.pathname).toBe("/smartscan/mobile/session-0001");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#camera");
  });

  it("rejects cross-session and cross-assessment envelope construction", async () => {
    await expect(buildPhoneSubmissionEnvelope({
      capability,
      scan: { ...scan, sessionId: "other-session" },
      sequenceNumber: 1,
    })).rejects.toThrow("phone_submission_session_mismatch");
    await expect(buildPhoneSubmissionEnvelope({
      capability,
      scan: { ...scan, assessmentId: "other-assessment" },
      sequenceNumber: 1,
    })).rejects.toThrow("phone_submission_assessment_mismatch");
  });
});
