import { describe, it, expect } from 'vitest';
import { BOT_AVATAR_URL, ttsVoiceForBot } from '../../client/lib/avatar';

describe('avatar config', () => {
  it('exposes an https GLB url', () => {
    expect(BOT_AVATAR_URL).toMatch(/^https:\/\/.+\.glb$/);
  });
  it('maps a bot to a default voice', () => {
    expect(ttsVoiceForBot('bot-ugly')).toBeTruthy();
  });
});
