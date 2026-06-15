import { describe, it, expect } from 'vitest';
import { ConversationSchema, BotSchema } from '../../shared/collections';

describe('backgrounds removed', () => {
  it('Conversation schema has no declared background key', () => {
    // ZodCatchall stores shape directly in _def.shape (not _def.schema.shape)
    const shape = (ConversationSchema._def as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape)).not.toContain('background');
  });
  it('Bot schema has no declared backgroundUrl key', () => {
    const shape = (BotSchema._def as { shape: Record<string, unknown> }).shape;
    expect(Object.keys(shape)).not.toContain('backgroundUrl');
  });
});
