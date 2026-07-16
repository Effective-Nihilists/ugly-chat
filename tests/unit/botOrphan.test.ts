import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collections } from '../../shared/collections';

const created = vi.fn();
vi.mock('ugly-app/conversation/engine', () => ({
  conversationMessageCreate: (...args: unknown[]) => {
    created(...args);
    return Promise.resolve();
  },
}));
vi.mock('ugly-app/server/adapter/workers', () => ({ getUserToken: () => 'test-token' }));
vi.mock('../../server/listDenorm', () => ({ bumpListForMessage: () => Promise.resolve() }));

import { triggerBotReplies } from '../../server/bots';

/**
 * A db where the caller controls the conversation doc and which bot rows exist.
 * Models the migration gap: a conversation still lists a bot member whose `bot`
 * config row is gone (or was never created for a non-`bot-` migrated id).
 */
function makeDb(conv: Record<string, unknown>, botRows: Record<string, Record<string, unknown>>) {
  return {
    async getDoc(collection: unknown, id: string) {
      if (collection === collections.conversation) return conv._id === id ? conv : null;
      if (collection === collections.bot) return botRows[id] ?? null;
      return null;
    },
    async getDocs(collection: unknown) {
      if (collection !== collections.message) return [];
      return [{ _id: 'm1', conversationId: conv._id, userId: 'u1', text: 'ping', created: 1 }];
    },
  };
}

const run = (conv: Record<string, unknown>, botRows: Record<string, Record<string, unknown>> = {}) =>
  triggerBotReplies(
    makeDb(conv, botRows) as never,
    { conversation: collections.conversation, message: collections.message },
    conv._id as string,
    'u1',
  );

const posted = () =>
  created.mock.calls.map((c) => ({
    sender: c[1] as string,
    message: c[0]?.message as { markdown: string; color?: string },
  }));

describe('triggerBotReplies — orphaned / migrated bot members', () => {
  beforeEach(() => {
    created.mockClear();
    // No network reply should ever be needed in these tests (the bots are dead).
    vi.stubGlobal('fetch', () => Promise.reject(new Error('fetch should not be called')));
  });

  it('does NOT die silently for a DM bot member whose config row is gone — posts an actionable message', async () => {
    const conv = {
      _id: 'u45WZL-xWrAfFRva7KSkr+u1',
      type: 'bot',
      bots: { 'u45WZL-xWrAfFRva7KSkr': { model: 'gemini_2_5' } },
      users: { 'u45WZL-xWrAfFRva7KSkr': { isBot: true }, u1: { isBot: false } },
    };
    await run(conv);
    const msgs = posted();
    expect(msgs.length).toBe(1);
    expect(msgs[0].sender).toBe('u45WZL-xWrAfFRva7KSkr');
    expect(msgs[0].message.color).toBe('error');
    expect(msgs[0].message.markdown.toLowerCase()).toContain('re-create');
    // It must not echo the user or pretend to answer.
    expect(msgs[0].message.markdown).not.toContain('ping');
  });

  it('also handles a migrated bot member in a GROUP chat (not part of a + DM id)', async () => {
    const conv = {
      _id: 'grp1',
      type: 'bot',
      bots: { 'mig-bot-xyz': {} },
      users: { 'mig-bot-xyz': { isBot: true }, u1: { isBot: false } },
    };
    await run(conv);
    const msgs = posted();
    expect(msgs.length).toBe(1);
    expect(msgs[0].sender).toBe('mig-bot-xyz');
    expect(msgs[0].message.color).toBe('error');
  });

  it('does NOT reply for a webhook/app bot member (owning app drives it), even if non-prefixed', async () => {
    const conv = {
      _id: 'grp2',
      type: 'bot',
      bots: { 'app-bot-1': {} },
      users: { 'app-bot-1': { isBot: true }, u1: { isBot: false } },
    };
    // Row exists but is webhook-driven → Ugly Chat must stay silent (no textGen, no orphan msg).
    await run(conv, { 'app-bot-1': { _id: 'app-bot-1', name: 'App Bot', model: 'x', instruction: 'i', webhookUrl: 'https://app/hook' } });
    expect(posted().length).toBe(0);
  });
});
