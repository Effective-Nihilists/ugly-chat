import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collections } from '../../shared/collections';

// Avoid pulling the real conversation engine / workers adapter / list denorm.
const created = vi.fn();
vi.mock('ugly-app/conversation/engine', () => ({
  conversationMessageCreate: (...args: unknown[]) => {
    created(...args);
    return Promise.resolve();
  },
}));
vi.mock('ugly-app/server/adapter/workers', () => ({
  getUserToken: () => 'test-token',
}));
vi.mock('../../server/listDenorm', () => ({
  bumpListForMessage: () => Promise.resolve(),
}));

import { triggerBotReplies } from '../../server/bots';

// A mock db whose getDocs faithfully honours { sort: { created }, limit } so the
// test exercises the REAL query the handler asks for (oldest-vs-newest window).
function makeDb(messages: Record<string, unknown>[]) {
  return {
    async getDoc(collection: unknown, id: string) {
      if (collection === collections.conversation && id === 'c1') {
        return { _id: 'c1', type: 'bot', bots: { 'bot-ugly': {} } };
      }
      if (collection === collections.bot && id === 'bot-ugly') {
        return { _id: 'bot-ugly', name: 'Ugly Bot', model: 'deepseek_v4_flash', instruction: 'persona' };
      }
      return null;
    },
    async getDocs(
      collection: unknown,
      _filter?: Record<string, unknown>,
      options?: { sort?: Record<string, 1 | -1>; limit?: number },
    ) {
      if (collection !== collections.message) return [];
      const dir = options?.sort?.['created'] ?? 1;
      const sorted = [...messages].sort((a, b) =>
        dir === 1
          ? Number(a['created']) - Number(b['created'])
          : Number(b['created']) - Number(a['created']),
      );
      return options?.limit ? sorted.slice(0, options.limit) : sorted;
    },
  };
}

describe('triggerBotReplies — history sent to the model', () => {
  let lastBody: { messages: { role: string; content: string }[] } | null = null;

  beforeEach(() => {
    lastBody = null;
    created.mockClear();
    vi.stubGlobal('fetch', (_url: string, init: { body: string }) => {
      lastBody = JSON.parse(init.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ message: { content: 'reply' }, usage: {} }),
      } as Response);
    });
  });

  it('sends the user’s MOST RECENT message, not the oldest, in a long conversation', async () => {
    // 25 messages; the latest (created 25) is the question the bot must answer.
    const messages = Array.from({ length: 25 }, (_, i) => ({
      _id: `m${i + 1}`,
      conversationId: 'c1',
      userId: 'u1',
      text: i === 24 ? 'LATEST_USER_QUESTION' : `old message ${i + 1}`,
      created: i + 1,
    }));

    await triggerBotReplies(
      makeDb(messages) as never,
      { conversation: collections.conversation, message: collections.message },
      'c1',
      'u1',
    );

    expect(lastBody).not.toBeNull();
    const history = lastBody!.messages.filter((m) => m.role !== 'system');
    // The conversation has > 20 messages; the bot must still see the newest one
    // as the final turn (the bug fed it the oldest 20 instead).
    expect(history[history.length - 1]?.content).toBe('LATEST_USER_QUESTION');
    // And the window must be chronological (oldest of the window first).
    expect(history.length).toBe(20);
  });
});
