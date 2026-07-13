// Small ID + token helpers. Kept separate so they are easy to test/replace.

export function uid(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-4);
  return prefix + rand + time;
}

// RFC 4122 v4 event id for idempotent append-only audit writes.
export function uuidV4(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

// Short, human-printable token used to make each QR sheet unique.
export function securityToken(): string {
  const bytes = new Uint8Array(8);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  // Non-browser test/legacy fallback. Production browsers are required to
  // expose Web Crypto before sheets are generated.
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`.slice(0, 16).toUpperCase();
}

// Deterministic djb2 checksum (base36). Not cryptographic — it exists to
// catch damaged or hand-edited QR payloads, not to stop an attacker.
export function checksumOf(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}
