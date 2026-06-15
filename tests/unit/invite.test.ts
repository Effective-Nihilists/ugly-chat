import { describe, it, expect, vi } from 'vitest';
import { buildInviteEmail, sendInviteEmail } from '../../server/invite';

describe('buildInviteEmail', () => {
  it('addresses the recipient and links the conversation', () => {
    const m = buildInviteEmail('ghost@nowhere.dev', 'u_justin', 'grp-1', 'https://ugly.chat');
    expect(m.to).toBe('ghost@nowhere.dev');
    expect(m.html).toContain('https://ugly.chat');
    expect(m.html).toContain('grp-1');
  });
});

describe('sendInviteEmail', () => {
  it('POSTs the built message to the email-send endpoint', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch;
    const env = { EMAIL_SEND_URL: 'https://send.ugly.bot', EMAIL_SEND_TOKEN: 'tok', APP_URL: 'https://ugly.chat' };
    await sendInviteEmail('ghost@nowhere.dev', 'u_justin', 'grp-1', env, fetchFn);
    const calls = (fetchFn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(String(calls[0][0])).toContain('send.ugly.bot');
    const init = calls[0][1] as { method?: string; body?: string };
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body ?? '{}') as { to?: string; html?: string };
    expect(body.to).toBe('ghost@nowhere.dev');
    expect(body.html).toContain('grp-1');
  });
});
