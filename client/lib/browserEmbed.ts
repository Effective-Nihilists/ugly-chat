import { useSyncExternalStore } from 'react';

export interface BrowserEmbedContext {
  embedded: boolean;
  theme: 'light' | 'dark';
}

export interface BrowserConversationMeta {
  id: string;
  title: string;
  unread: number;
}

const DEFAULT_CONTEXT: BrowserEmbedContext = {
  embedded: false,
  theme: 'light',
};
const MAX_CONVERSATIONS = 24;
let context = DEFAULT_CONTEXT;
let installed = false;
let pendingSelection: string | null = null;
const contextListeners = new Set<() => void>();
const selectionListeners = new Set<(conversationId: string) => void>();

function boundedMetadataText(raw: unknown, max: number): string {
  if (typeof raw !== 'string') return '';
  return Array.from(raw)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return (
        code > 31 &&
        code !== 127 &&
        !(code >= 0x202a && code <= 0x202e) &&
        !(code >= 0x2066 && code <= 0x2069)
      );
    })
    .join('')
    .trim()
    .slice(0, max);
}

function normalizeContext(raw: unknown): BrowserEmbedContext | null {
  const value = raw as { embedded?: unknown; theme?: unknown } | null;
  if (value?.embedded !== true) return null;
  return {
    embedded: true,
    theme: value.theme === 'dark' ? 'dark' : 'light',
  };
}

function applyContext(next: BrowserEmbedContext): void {
  context = next;
  if (typeof document !== 'undefined') {
    document.documentElement.toggleAttribute(
      'data-browser-embedded',
      next.embedded,
    );
    if (next.embedded) document.documentElement.dataset.theme = next.theme;
  }
  for (const listener of contextListeners) listener();
}

export function installBrowserEmbedBridge(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.uglyBrowser?.onContext?.((raw) => {
    const next = normalizeContext(raw);
    if (next) applyContext(next);
  });
  window.uglyBrowser?.onSelectConversation?.((raw) => {
    const id = boundedMetadataText(raw, 160);
    if (!id) return;
    if (selectionListeners.size === 0) pendingSelection = id;
    else for (const listener of selectionListeners) listener(id);
  });
}

export function useBrowserEmbed(): BrowserEmbedContext {
  return useSyncExternalStore(
    (listener) => {
      contextListeners.add(listener);
      return () => contextListeners.delete(listener);
    },
    () => context,
    () => DEFAULT_CONTEXT,
  );
}

export function onBrowserConversationSelection(
  listener: (conversationId: string) => void,
): () => void {
  selectionListeners.add(listener);
  if (pendingSelection) {
    const id = pendingSelection;
    pendingSelection = null;
    listener(id);
  }
  return () => selectionListeners.delete(listener);
}

export function publishBrowserConversations(
  conversations: BrowserConversationMeta[],
  activeConversationId: string | null,
): void {
  if (!context.embedded) return;
  const seen = new Set<string>();
  const rows: BrowserConversationMeta[] = [];
  for (const row of conversations.slice(0, MAX_CONVERSATIONS)) {
    const id = boundedMetadataText(row.id, 160);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      title: boundedMetadataText(row.title, 120) || 'Conversation',
      unread: Number.isFinite(row.unread)
        ? Math.max(0, Math.min(999, Math.trunc(row.unread)))
        : 0,
    });
  }
  const active = boundedMetadataText(activeConversationId, 160);
  window.uglyBrowser?.publishConversations?.({
    conversations: rows,
    activeConversationId: active && seen.has(active) ? active : null,
    complete: conversations.length <= MAX_CONVERSATIONS,
  });
}

export function resetBrowserEmbedForTests(): void {
  context = DEFAULT_CONTEXT;
  installed = false;
  pendingSelection = null;
  contextListeners.clear();
  selectionListeners.clear();
}
