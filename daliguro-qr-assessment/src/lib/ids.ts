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
