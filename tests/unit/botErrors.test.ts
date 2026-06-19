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

function makeDb() {
  return {
    async getDoc(collection: unknown, id: string) {
      if (collection === collections.conversation && id === 'c1') {
        return { _id: 'c1', type: 'bot', bots: { 'bot-x': {} } };
      }
      if (collection === collections.bot && id === 'bot-x') {
        return { _id: 'bot-x', name: 'Helper', model: 'gemini_2_5', instruction: 'help' };
      }
      return null;
    },
    async getDocs(collection: unknown) {
      if (collection !== collections.message) return [];
      return [{ _id: 'm1', conversationId: 'c1', userId: 'u1', text: 'translate this', created: 1 }];
    },
  };
}

const run = () =>
  triggerBotReplies(
    makeDb() as never,
    { conversation: collections.conversation, message: collections.message },
    'c1',
    'u1',
  );
const postedMessage = () => created.mock.calls[0]?.[0]?.message as { markdown: string; color?: string };

describe('triggerBotReplies — failure handling (no echo)', () => {
  beforeEach(() => created.mockClear());

  it('surfaces a payment error with a fix link instead of echoing the user', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: false,
        status: 402,
        json: () => Promise.resolve({ error: 'Insufficient balance — add credits or subscribe' }),
      } as Response),
    );
    await run();
    const msg = postedMessage();
    expect(msg.markdown).toContain('https://ugly.bot/billing');
    expect(msg.markdown.toLowerCase()).toContain('credits');
    expect(msg.color).toBe('error');
    // Must NOT echo the user's own message.
    expect(msg.markdown).not.toContain('translate this');
    expect(msg.markdown).not.toContain('You said');
  });

  it('shows a clear error (not an echo) when the model returns nothing', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ message: { content: '' } }),
      } as Response),
    );
    await run();
    const msg = postedMessage();
    expect(msg.color).toBe('error');
    expect(msg.markdown).not.toContain('You said');
    expect(msg.markdown).not.toContain('translate this');
    expect(msg.markdown.toLowerCase()).toContain("couldn't generate");
  });
});
