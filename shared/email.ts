// Email normalization + validation. Shared by client (live input check) and
// server (resolver). Membership is keyed by email — no usernames, no friend
// requests — so a single canonical normalization matters.
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(raw: string): boolean {
  return RE.test(normalizeEmail(raw));
}
