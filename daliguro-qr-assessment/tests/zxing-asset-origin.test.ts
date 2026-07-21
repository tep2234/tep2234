// Phase 2 — offline WASM contract.
//
// These tests exercise the APPLICATION'S OWN asset locator, not the absence of
// a string in a bundle. The bundle legitimately still contains zxing-wasm's
// default jsDelivr URL as dead code, so a grep-based test would either fail
// spuriously or pass vacuously. What actually matters is that the locator the
// app hands to zxing-wasm can never resolve to a remote origin.

import { describe, expect, it, vi } from "vitest";

vi.mock("zxing-wasm/reader/zxing_reader.wasm?url", () => ({
  default: "/assets/zxing_reader-abc123.wasm",
}));

const { resolveZxingAssetUrl, RemoteWasmAssetError } = await import(
  "../src/lib/scanner/zxing-qr"
);

describe("zxing asset locator — accepts local assets", () => {
  it("accepts the root-relative hashed asset Vite emits", () => {
    expect(resolveZxingAssetUrl("/assets/zxing_reader-abc123.wasm")).toBe(
      "/assets/zxing_reader-abc123.wasm",
    );
  });

  it("accepts a relative asset path", () => {
    expect(resolveZxingAssetUrl("./assets/zxing_reader.wasm")).toBe(
      "./assets/zxing_reader.wasm",
    );
  });

  it("uses the bundled asset URL by default", () => {
    // The default argument is the real `?url` import, so this asserts the
    // production configuration resolves without throwing.
    expect(resolveZxingAssetUrl()).toBe("/assets/zxing_reader-abc123.wasm");
  });

  it("accepts an absolute URL that matches the page origin", () => {
    const sameOrigin = `${location.origin}/assets/zxing_reader-abc123.wasm`;
    expect(resolveZxingAssetUrl(sameOrigin)).toBe(sameOrigin);
  });
});

describe("zxing asset locator — refuses remote origins", () => {
  // This is the regression the whole phase exists to prevent: a future refactor
  // silently restoring zxing-wasm's default CDN behaviour.
  it("refuses the exact jsDelivr URL zxing-wasm defaults to", () => {
    expect(() =>
      resolveZxingAssetUrl(
        "https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.1/dist/reader/zxing_reader.wasm",
      ),
    ).toThrow(RemoteWasmAssetError);
  });

  it("refuses cdn.jsdelivr.net", () => {
    expect(() =>
      resolveZxingAssetUrl("https://cdn.jsdelivr.net/npm/zxing-wasm/zxing_reader.wasm"),
    ).toThrow(RemoteWasmAssetError);
  });

  it("refuses unpkg", () => {
    expect(() =>
      resolveZxingAssetUrl("https://unpkg.com/zxing-wasm/dist/reader/zxing_reader.wasm"),
    ).toThrow(RemoteWasmAssetError);
  });

  it("refuses an arbitrary third-party origin, not just known CDNs", () => {
    // An allow-list of bad hosts would be bypassed by any new host; the rule is
    // "same origin or nothing".
    expect(() =>
      resolveZxingAssetUrl("https://example-attacker.test/zxing_reader.wasm"),
    ).toThrow(RemoteWasmAssetError);
  });

  it("refuses an empty asset URL rather than letting the library pick a default", () => {
    expect(() => resolveZxingAssetUrl("")).toThrow(RemoteWasmAssetError);
  });

  it("carries an actionable message naming the offending URL", () => {
    try {
      resolveZxingAssetUrl("https://fastly.jsdelivr.net/npm/zxing-wasm/x.wasm");
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RemoteWasmAssetError);
      expect((err as Error).message).toContain("jsdelivr.net");
      expect((err as Error).message).toContain("offline");
    }
  });
});
