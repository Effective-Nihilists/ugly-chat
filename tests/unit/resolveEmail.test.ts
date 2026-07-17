import { describe, it, expect, vi } from 'vitest';
import { resolveEmailToUser } from '../../server/resolveEmail';

const env = { UGLY_BOT_URL: 'https://ugly.bot', UGLY_BOT_TOKEN: 'tok' };

const urlOf = (fetchFn: unknown, i = 0): string =>
  String((fetchFn as { mock: { calls: unknown[][] } }).mock.calls[i]![0]);

describe('resolveEmailToUser', () => {
  it('returns the userId for a known email', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ user: { userId: 'u_dana', name: 'Dana' } }) })) as unknown as typeof fetch;
    const r = await resolveEmailToUser('Dana@Studio.dev', env, fetchFn);
    expect(r).toEqual({ status: 'found', userId: 'u_dana', name: 'Dana' });
    // called with normalized email
    expect(urlOf(fetchFn)).toContain('dana%40studio.dev');
  });
  // The live route is `GET /v1/users/by-email?email=` (ugly-bot server/proxy/users.ts).
  // `/v1/users/email` is the INVERSE op (POST userId→email) and, as a GET, is served
  // the SPA's HTML — so res.json() threw, the caller swallowed it, and every attempt
  // to start a human chat died as "No recipients". Pin the path.
  it('calls GET /v1/users/by-email (not the inverse /v1/users/email)', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ user: { userId: 'u1', name: 'A' } }) })) as unknown as typeof fetch;
    await resolveEmailToUser('a@b.dev', env, fetchFn);
    expect(urlOf(fetchFn)).toContain('/v1/users/by-email?email=');
    expect(urlOf(fetchFn)).not.toContain('/v1/users/email?');
  });
  it('returns pending-invite when unknown (404)', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
    const r = await resolveEmailToUser('ghost@nowhere.dev', env, fetchFn);
    expect(r).toEqual({ status: 'invite', email: 'ghost@nowhere.dev' });
  });
  // The real endpoint answers 200 `{ user: null }` for an unknown address.
  it('returns pending-invite on 200 { user: null }', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ user: null }) })) as unknown as typeof fetch;
    const r = await resolveEmailToUser('ghost@nowhere.dev', env, fetchFn);
    expect(r).toEqual({ status: 'invite', email: 'ghost@nowhere.dev' });
  });
  it('throws on invalid email', async () => {
    await expect(resolveEmailToUser('nope', env, vi.fn() as unknown as typeof fetch)).rejects.toThrow(/invalid email/i);
  });
});
