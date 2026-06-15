import { describe, it, expect } from 'vitest';
import { avatarColor } from '../../client/lib/conversations';

describe('avatarColor', () => {
  it('returns the neutral elevated-surface token for every seed', () => {
    expect(avatarColor('anything')).toBe('var(--app-tertiary)');
    expect(avatarColor('bot-ugly')).toBe('var(--app-tertiary)');
  });
});
