import { describe, expect, it } from 'vitest';
import { GRID_MAX, rankPeers } from '../../client/components/VideoCall';
import type { CallParticipant } from '../../client/components/VideoCall';

const peer = (userId: string, isBot = false): CallParticipant => ({ userId, isBot });

describe('rankPeers', () => {
  it('gives every peer a tile up to the grid limit', () => {
    // The regression this guards: the stage used to render exactly one peer
    // (`participants.find(p => p.userId !== me)`), so a verified 3-way call —
    // all three publishing tracks — still showed a single tile.
    for (const n of [1, 2, 3, GRID_MAX]) {
      const peers = Array.from({ length: n }, (_, i) => peer(`u${i}`));
      const { heroPeers, stripPeers } = rankPeers(peers, null);
      expect(heroPeers).toHaveLength(n);
      expect(stripPeers).toHaveLength(0);
    }
  });

  it('promotes the active speaker and strips the rest past the limit', () => {
    const peers = Array.from({ length: 7 }, (_, i) => peer(`u${i}`));
    const { heroPeers, stripPeers } = rankPeers(peers, 'u5');
    expect(heroPeers.map((p) => p.userId)).toEqual(['u5']);
    expect(stripPeers).toHaveLength(6);
    expect(stripPeers.map((p) => p.userId)).not.toContain('u5');
  });

  it('still fills the stage when nobody is speaking', () => {
    const peers = Array.from({ length: 6 }, (_, i) => peer(`u${i}`));
    const { heroPeers, stripPeers } = rankPeers(peers, null);
    expect(heroPeers.map((p) => p.userId)).toEqual(['u0']);
    expect(stripPeers).toHaveLength(5);
  });

  it('never drops or duplicates a peer', () => {
    const peers = Array.from({ length: 9 }, (_, i) => peer(`u${i}`, i === 2));
    const { heroPeers, stripPeers } = rankPeers(peers, 'u2');
    const ids = [...heroPeers, ...stripPeers].map((p) => p.userId);
    expect(new Set(ids).size).toBe(9);
    expect(ids.sort()).toEqual(peers.map((p) => p.userId).sort());
  });

  it('has no self tile to leak — peers are pre-filtered', () => {
    expect(rankPeers([], null)).toEqual({ heroPeers: [], stripPeers: [] });
  });
});
