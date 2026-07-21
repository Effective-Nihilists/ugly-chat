import { normalizeEmail, isValidEmail } from '../shared/email';

// Resolve an email address to an ugly.bot userId, or mark it for an invite when
// no account exists.
//
// The live route is `GET /v1/users/by-email?email=` (ugly-bot
// `server/proxy/users.ts`), which answers `{ user: { userId, name, avatarUrl } }`
// or `{ user: null }`. It was previously pointed at `/v1/users/email` — that is
// the INVERSE op (POST userId→email); as a GET it is served the SPA's HTML, so
// `res.json()` threw, the caller swallowed it, and every attempt to start a chat
// with a human died as "No recipients". Isolated behind an injected `fetchFn`.
export type ResolveResult =
  | { status: 'found'; userId: string; name: string }
  | { status: 'invite'; email: string };

export interface ResolveEnv {
  UGLY_BOT_URL?: string | undefined;
  UGLY_BOT_TOKEN?: string | undefined;
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
  const res = await fetchFn(`${base}/v1/users/by-email?email=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // Guard on content-type: a 200 with HTML (SPA fallback / misroute) would make
  // res.json() throw and blow up the whole "start a chat with a human" flow.
  // Any non-JSON / non-2xx / missing-user response degrades to the invite path.
  const ct = res.headers.get('content-type') ?? '';
  if (res.ok && ct.includes('application/json')) {
    const data = (await res.json().catch(() => null)) as
      | { user?: { userId?: string; name?: string } }
      | null;
    if (data?.user?.userId) {
      return { status: 'found', userId: data.user.userId, name: data.user.name ?? email };
    }
  }
  // 404 / no user / non-JSON → invite path (the invite email is sent by the create handler)
  return { status: 'invite', email };
}
