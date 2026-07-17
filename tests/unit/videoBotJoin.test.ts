import { describe, expect, it } from 'vitest';
import { videoBotJoin } from '../../server/video';
import type { Conversation } from '../../shared/collections';

// Minimal in-memory db: enough for videoJoin's getDoc/setDocFields round-trip.
// A call with one human already in it — the only state a bot may join.
const humanCall = {
  call: {
    active: true,
    startedAt: 1,
    participants: { alice: { userId: 'alice', isBot: false, joinedAt: 1 } },
  },
} as unknown as Partial<Conversation>;

function fakeDb(conv: Partial<Conversation>) {
  const doc = { _id: 'c1', ...conv } as Conversation;
  return {
    // eslint-disable-next-line @typescript-eslint/require-await
    getDoc: async () => doc,
    setDocFields: async (_c: unknown, _id: string, fields: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(fields)) {
        if (k.startsWith('call.participants.')) {
          const call = ((doc as Record<string, unknown>).call ??= { participants: {} }) as {
            participants: Record<string, unknown>;
          };
          call.participants[k.slice('call.participants.'.length)] = v;
        }
      }
      return Promise.resolve(doc);
    },
  } as never;
}
const collections = { conversation: {} } as never;

describe('videoBotJoin', () => {
  // The regression: this was gated on `botUser()`, which only resolves the
  // static built-in BOTS map. The canonical Ugly Bot moved to the `bot`
  // collection, so every `bot-ugly` call threw "not a bot" and the avatar never
  // joined — the app's flagship bot call was dead end-to-end.
  it('admits the canonical Ugly Bot', async () => {
    const state = await videoBotJoin(fakeDb(humanCall), collections, 'c1', 'bot-ugly');
    expect(state.participants['bot-ugly']).toMatchObject({ userId: 'bot-ugly', isBot: true });
  });

  it('admits collection-backed custom bots', async () => {
    const state = await videoBotJoin(fakeDb(humanCall), collections, 'c1', 'bot-custom-xyz');
    expect(state.participants['bot-custom-xyz']?.isBot).toBe(true);
  });

  it('still admits static built-ins', async () => {
    const state = await videoBotJoin(fakeDb(humanCall), collections, 'c1', 'bot-sage');
    expect(state.participants['bot-sage']?.isBot).toBe(true);
  });

  it('rejects a non-bot id so a human cannot be joined as a fake participant', async () => {
    await expect(videoBotJoin(fakeDb(humanCall), collections, 'c1', 'w2ZBBoU5Jf83')).rejects.toThrow(
      'not a bot',
    );
  });

  // The critical bug: a bot never leaves and never heartbeats, so a bot-only
  // roster left `active: true` in the doc forever and every client rang off it —
  // surviving Decline, reload and a fresh session. Only `videoState` prunes, and
  // nothing polls it unless someone is joined, so nobody was left to clean up.
  it('refuses to join when no call is active', async () => {
    await expect(videoBotJoin(fakeDb({}), collections, 'c1', 'bot-ugly')).rejects.toThrow(
      'no active call',
    );
  });

  it('refuses to join a call the last human already left', async () => {
    // The resurrection race: an in-flight bot-join landing just after videoLeave.
    const ended = { call: { active: false, participants: {} } } as unknown as Partial<Conversation>;
    await expect(videoBotJoin(fakeDb(ended), collections, 'c1', 'bot-ugly')).rejects.toThrow(
      'no active call',
    );
  });

  it('refuses to join a roster holding only other bots', async () => {
    const botsOnly = {
      call: {
        active: true,
        participants: { 'bot-sage': { userId: 'bot-sage', isBot: true, joinedAt: 1 } },
      },
    } as unknown as Partial<Conversation>;
    await expect(videoBotJoin(fakeDb(botsOnly), collections, 'c1', 'bot-ugly')).rejects.toThrow(
      'no active call',
    );
  });
});
