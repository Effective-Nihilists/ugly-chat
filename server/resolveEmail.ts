import { normalizeEmail, isValidEmail } from '../shared/email';

// Resolve an email address to an ugly.bot userId, or mark it for an invite when
// no account exists. The exact ugly.bot lookup path (`/v1/users/email`) is the
// one unconfirmed external dependency in this flow — it's isolated here behind
// an injected `fetchFn` so confirming/changing it touches only this file and
// its test. Downstream handlers consume `ResolveResult` unchanged.
export type ResolveResult =
  | { status: 'found'; userId: string; name: string }
  | { status: 'invite'; email: string };

export interface ResolveEnv {
  UGLY_BOT_URL?: string;
  UGLY_BOT_TOKEN?: string;
}

export async function resolveEmailToUser(
  rawEmail: string,
  env: ResolveEnv,
  fetchFn: typeof fetch = fetch,
): Promise<ResolveResult> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) throw new Error('invalid email');
  const base = env.UGLY_BOT_URL ?? 'https://ugly.bot';
  const token = env.UGLY_BOT_TOKEN;
  if (!token) throw new Error('UGLY_BOT_TOKEN not set');
  const res = await fetchFn(`${base}/v1/users/email?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    const data = (await res.json()) as { user?: { userId?: string; name?: string } };
    if (data.user?.userId) {
      return { status: 'found', userId: data.user.userId, name: data.user.name ?? email };
    }
  }
  // 404 / no user → invite path (the invite email is sent by the create handler)
  return { status: 'invite', email };
}
