import { describe, it, expect } from 'vitest';
import { directConversationId } from '../../shared/conversationId';
describe('directConversationId', () => {
  it('is order-independent', () => {
    expect(directConversationId('b', 'a')).toBe(directConversationId('a', 'b'));
    expect(directConversationId('a', 'b')).toBe('dm-a+b');
  });
});
