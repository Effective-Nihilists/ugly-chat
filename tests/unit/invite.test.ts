import { describe, it, expect, vi } from 'vitest';
import { buildInviteEmail, sendInviteEmail } from '../../server/invite';

describe('buildInviteEmail', () => {
  it('addresses the recipient, shows the conversation, and uses the share link', () => {
    const m = buildInviteEmail(
      'ghost@nowhere.dev',
      'u_justin',
      'grp-1',
      'https://ugly.chat',
      'https://ugly.bot/l/abc123',
    );
    expect(m.to).toBe('ghost@nowhere.dev');
    expect(m.html).toContain('https://ugly.chat');
    expect(m.html).toContain('grp-1');
    expect(m.html).toContain('https://ugly.bot/l/abc123');
  });
});

describe('sendInviteEmail', () => {
  it('mints a short share link and POSTs the built message', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    const shareLinkFn = vi.fn(async () => 'https://ugly.bot/l/abc123') as unknown as typeof import('ugly-app/server/adapter/workers').shareLink;
    const env = { EMAIL_SEND_URL: 'https://send.ugly.bot', EMAIL_SEND_TOKEN: 'tok', APP_URL: 'https://ugly.chat' };
    await sendInviteEmail('ghost@nowhere.dev', 'u_justin', 'grp-1', env, fetchFn, shareLinkFn);
    expect(shareLinkFn).toHaveBeenCalledWith(
      expect.objectContaining({ requireAuth: true, target: expect.stringContaining('grp-1') }),
    );
    const calls = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(String(calls[0][0])).toContain('send.ugly.bot');
    const init = calls[0][1] as { method?: string; body?: string };
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body ?? '{}') as { to?: string; html?: string };
    expect(body.to).toBe('ghost@nowhere.dev');
    expect(body.html).toContain('https://ugly.bot/l/abc123');
  });
});
