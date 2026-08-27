import { describe, expect, it, vi } from 'vitest';
import { deleteOrLeaveConversation } from '../../client/lib/conversations';

/**
 * Production evidence (ugly-chat, 2026-08-20 and 2026-08-22):
 *
 *   [browser-action] remove failed errorDoesNotExist
 *
 * The browser shell asks Chat to remove a conversation. `conversationDelete`
 * reads the caller's `conversationUser` row to check ownership; when the
 * conversation is already gone that row is gone too, so `self?.role !== 'owner'`
 * throws. `deleteOrLeaveConversation` then falls back to LEAVING it, and the
 * framework answers `errorDoesNotExist` — which surfaced to the user as
 * "Ugly Chat could not complete that."
 *
 * Removing something already removed is the user's goal already met. It is a
 * success, not a failure — otherwise deleting the same chat from two tabs, or
 * retrying after a dropped socket, reports an error for work that is done.
 */
function socketThat(...outcomes: (Error | 'ok')[]) {
  const queue = [...outcomes];
  return {
    calls: [] as string[],
    request(name: string) {
      this.calls.push(name);
      const next = queue.shift();
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({ ok: true });
    },
  };
}

describe('deleteOrLeaveConversation', () => {
  it('resolves when the conversation is already gone', async () => {
    const socket = socketThat(
      new Error('Only an owner can delete this conversation'),
      new Error('errorDoesNotExist'),
    );
    await expect(
      deleteOrLeaveConversation(socket, 'c1', 'u1'),
    ).resolves.toBeUndefined();
    expect(socket.calls).toEqual([
      'conversationDelete',
      'conversationMemberRemove',
    ]);
  });

  it('resolves when the delete itself reports it is already gone', async () => {
    const socket = socketThat(new Error('errorDoesNotExist'));
    await expect(
      deleteOrLeaveConversation(socket, 'c1', 'u1'),
    ).resolves.toBeUndefined();
    // No pointless leave attempt for a conversation that does not exist.
    expect(socket.calls).toEqual(['conversationDelete']);
  });

  it('still deletes as the owner', async () => {
    const socket = socketThat('ok');
    await expect(
      deleteOrLeaveConversation(socket, 'c1', 'u1'),
    ).resolves.toBeUndefined();
    expect(socket.calls).toEqual(['conversationDelete']);
  });

  it('still leaves when the caller is not the owner', async () => {
    const socket = socketThat(
      new Error('Only an owner can delete this conversation'),
      'ok',
    );
    await deleteOrLeaveConversation(socket, 'c1', 'u1');
    expect(socket.calls).toEqual([
      'conversationDelete',
      'conversationMemberRemove',
    ]);
  });

  it('still propagates a real failure', async () => {
    const socket = socketThat(
      new Error('Only an owner can delete this conversation'),
      new Error('errorRateLimited'),
    );
    await expect(deleteOrLeaveConversation(socket, 'c1', 'u1')).rejects.toThrow(
      'errorRateLimited',
    );
  });
});
