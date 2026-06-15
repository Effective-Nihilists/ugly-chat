import { describe, it, expect, vi } from 'vitest';
import { resolveEmailToUser } from '../../server/resolveEmail';

const env = { UGLY_BOT_URL: 'https://ugly.bot', UGLY_BOT_TOKEN: 'tok' };

describe('resolveEmailToUser', () => {
  it('returns the userId for a known email', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ user: { userId: 'u_dana', name: 'Dana' } }) })) as unknown as typeof fetch;
    const r = await resolveEmailToUser('Dana@Studio.dev', env, fetchFn);
    expect(r).toEqual({ status: 'found', userId: 'u_dana', name: 'Dana' });
    // called with normalized email
    expect(String((fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toContain('dana%40studio.dev');
  });
  it('returns pending-invite when unknown (404)', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
    const r = await resolveEmailToUser('ghost@nowhere.dev', env, fetchFn);
    expect(r).toEqual({ status: 'invite', email: 'ghost@nowhere.dev' });
  });
  it('throws on invalid email', async () => {
    await expect(resolveEmailToUser('nope', env, vi.fn() as unknown as typeof fetch)).rejects.toThrow(/invalid email/i);
  });
});
