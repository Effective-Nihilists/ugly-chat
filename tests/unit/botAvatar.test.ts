import { describe, it, expect } from 'vitest';
import { defaultAvatar } from 'ugly-app/shared';
import { botAvatar } from '../../server/avatar';

describe('botAvatar', () => {
  it('prefers the linked character thumbnail over avatar object and avatarUrl', () => {
    const doc = {
      avatar: { ...defaultAvatar, image: { uri: 'https://cdn/x/uploaded.png' } },
      avatarUrl: 'https://cdn/x/legacy.png',
      characterThumbnail: 'https://cdn/x/char.webp',
    };
    expect(botAvatar(doc).image.uri).toBe('https://cdn/x/char.webp');
  });

  it('falls back to the avatar object, then avatarUrl, then the default', () => {
    expect(
      botAvatar({ avatar: { ...defaultAvatar, image: { uri: 'https://cdn/x/uploaded.png' } } }).image.uri,
    ).toBe('https://cdn/x/uploaded.png');
    expect(botAvatar({ avatarUrl: 'https://cdn/x/legacy.png' }).image.uri).toBe('https://cdn/x/legacy.png');
    expect(botAvatar({})).toBe(defaultAvatar);
  });

  it('ignores an empty character thumbnail', () => {
    expect(botAvatar({ characterThumbnail: '', avatarUrl: 'https://cdn/x/legacy.png' }).image.uri).toBe(
      'https://cdn/x/legacy.png',
    );
  });
});
