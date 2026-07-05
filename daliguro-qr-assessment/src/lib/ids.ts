// Small ID + token helpers. Kept separate so they are easy to test/replace.

export function uid(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-4);
  return prefix + rand + time;
}

// Short, human-printable token used to make each QR sheet unique.
export function securityToken(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
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
