import { describe, expect, it } from 'vitest';
import { directConversationId, directConversationPeer } from '../../shared/conversationId';

describe('directConversationPeer', () => {
  // The regression: the header showed a raw `dm-G7QvP…` id instead of a name.
  // The old inline parse split on '+' without stripping the 'dm-' prefix, so
  // whenever OUR id sorted first the "peer" came back as `dm-<ourOwnId>`.
  it('round-trips the minted id from both sides', () => {
    const a = 'aaa111';
    const b = 'zzz999';
    const id = directConversationId(a, b);
    expect(directConversationPeer(id, a)).toBe(b);
    expect(directConversationPeer(id, b)).toBe(a);
  });

  it('works regardless of which id sorts first', () => {
    // `directConversationId` sorts, so exactly one participant is the prefixed
    // half — the case the old parser got wrong. Check both orderings.
    const lo = 'aaa';
    const hi = 'zzz';
    expect(directConversationPeer(directConversationId(lo, hi), lo)).toBe(hi);
    expect(directConversationPeer(directConversationId(hi, lo), lo)).toBe(hi);
  });

  it('never returns an id carrying the dm- prefix', () => {
    const peer = directConversationPeer(directConversationId('me', 'you'), 'me');
    expect(peer).not.toMatch(/^dm-/);
    expect(peer).toBe('you');
  });

  it('handles the legacy id shapes still in the wild', () => {
    // Bare '+' (pre-prefix DMs, incl. the canonical Ugly Bot chat) and the
    // framework-native ':' form both have to keep resolving.
    expect(directConversationPeer('bot-ugly+me', 'me')).toBe('bot-ugly');
    expect(directConversationPeer('me+bot-ugly', 'me')).toBe('bot-ugly');
    expect(directConversationPeer('alice:me', 'me')).toBe('alice');
  });

  it('returns null for ids that are not direct conversations', () => {
    expect(directConversationPeer('grp-me-abc', 'me')).toBeNull();
    expect(directConversationPeer('bc-bot1-me', 'me')).toBeNull();
    expect(directConversationPeer('', 'me')).toBeNull();
  });

  it('returns null when we are not a participant', () => {
    expect(directConversationPeer(directConversationId('alice', 'bob'), 'carol')).toBeNull();
  });
});
