import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installBrowserEmbedBridge,
  onBrowserConversationSelection,
  publishBrowserConversations,
  resetBrowserEmbedForTests,
} from '../../client/lib/browserEmbed';

afterEach(() => {
  resetBrowserEmbedForTests();
  vi.unstubAllGlobals();
});

describe('embedded browser contract', () => {
  it('publishes only bounded navigation metadata', () => {
    let contextListener: ((value: unknown) => void) | undefined;
    const publishConversations = vi.fn();
    vi.stubGlobal('window', {
      uglyBrowser: {
        onContext: (listener: (value: unknown) => void) => {
          contextListener = listener;
          return () => undefined;
        },
        onSelectConversation: () => () => undefined,
        publishConversations,
      },
    });
    vi.stubGlobal('document', {
      documentElement: {
        dataset: {},
        toggleAttribute: vi.fn(),
      },
    });
    installBrowserEmbedBridge();
    contextListener?.({ embedded: true, theme: 'dark', token: 'secret' });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.toggleAttribute).toHaveBeenCalledWith(
      'data-browser-embedded',
      true,
    );
    publishBrowserConversations(
      [
        {
          id: 'conversation\u0000\u202e-1',
          title: 'Plan\u2066ning',
          unread: 4,
          messages: ['secret'],
        } as never,
      ],
      'conversation\u0000\u202e-1',
    );
    expect(publishConversations).toHaveBeenCalledWith({
      conversations: [
        { id: 'conversation-1', title: 'Planning', unread: 4 },
      ],
      activeConversationId: 'conversation-1',
      complete: true,
    });
    expect(JSON.stringify(publishConversations.mock.calls)).not.toContain(
      'secret',
    );
  });

  it('deduplicates metadata, clamps unread, and rejects an unknown active id', () => {
    let contextListener: ((value: unknown) => void) | undefined;
    const publishConversations = vi.fn();
    vi.stubGlobal('window', {
      uglyBrowser: {
        onContext: (listener: (value: unknown) => void) => {
          contextListener = listener;
          return () => undefined;
        },
        publishConversations,
      },
    });
    vi.stubGlobal('document', {
      documentElement: { dataset: {}, toggleAttribute: vi.fn() },
    });
    installBrowserEmbedBridge();
    contextListener?.({ embedded: true, theme: 'light' });
    publishBrowserConversations(
      [
        { id: 'one', title: '', unread: Number.NaN },
        { id: 'one', title: 'Duplicate', unread: 2 },
        { id: 'two', title: 'Two', unread: 5000 },
      ],
      'missing',
    );
    expect(publishConversations).toHaveBeenCalledWith({
      conversations: [
        { id: 'one', title: 'Conversation', unread: 0 },
        { id: 'two', title: 'Two', unread: 999 },
      ],
      activeConversationId: null,
      complete: true,
    });
  });

  it('marks a capped feed incomplete so absence cannot be called deletion', () => {
    let contextListener: ((value: unknown) => void) | undefined;
    const publishConversations = vi.fn();
    vi.stubGlobal('window', { uglyBrowser: {
      onContext: (listener: (value: unknown) => void) => { contextListener = listener; return () => undefined; },
      publishConversations,
    } });
    vi.stubGlobal('document', { documentElement: { dataset: {}, toggleAttribute: vi.fn() } });
    installBrowserEmbedBridge();
    contextListener?.({ embedded: true, theme: 'light' });
    publishBrowserConversations(Array.from({ length: 25 }, (_, index) => ({
      id: `c-${index}`, title: `Chat ${index}`, unread: 0,
    })), null);
    expect(publishConversations).toHaveBeenCalledWith(expect.objectContaining({
      complete: false,
      conversations: expect.any(Array),
    }));
    expect(publishConversations.mock.calls[0][0].conversations).toHaveLength(24);
  });

  it('forwards only bounded stable conversation selections', () => {
    let selectListener: ((value: string) => void) | undefined;
    vi.stubGlobal('window', {
      uglyBrowser: {
        onContext: () => () => undefined,
        onSelectConversation: (listener: (value: string) => void) => {
          selectListener = listener;
          return () => undefined;
        },
      },
    });
    installBrowserEmbedBridge();
    selectListener?.(`  ${'x'.repeat(200)}  `);
    const selected = vi.fn();
    onBrowserConversationSelection(selected);
    expect(selected).toHaveBeenCalledWith('x'.repeat(160));
  });
});
