import { useSyncExternalStore } from "react";

export interface BrowserEmbedContext {
  embedded: boolean;
  theme: "light" | "dark";
  /** The embedding browser's own frame background, so the companion paints the
   *  same ground as the chrome around it. Absent when it sends none. */
  frame?: string;
}

export interface BrowserConversationMeta {
  id: string;
  title: string;
  unread: number;
  /** Pinned to the top of the list. The browser reflects this on its own row
   *  and offers to flip it — see `BrowserAction`. */
  pinned?: boolean;
  /** The row's secondary line in the browser sidebar — the conversation's most
   *  recent message, the way a tab row's second line is its URL. */
  lastMessage?: string;
  /** Row artwork: the other person's avatar in a direct chat, the group's image
   *  in a group one. Already resolved to a URL (see `resolveImageUrl`) — the
   *  browser holds no Chat credentials and cannot resolve one itself. */
  image?: string;
}

const DEFAULT_CONTEXT: BrowserEmbedContext = {
  embedded: false,
  theme: "light",
};
const MAX_CONVERSATIONS = 24;
let context = DEFAULT_CONTEXT;
let installed = false;
let pendingSelection: string | null = null;
let pendingAction: BrowserAction | null = null;
const contextListeners = new Set<() => void>();
const selectionListeners = new Set<(conversationId: string) => void>();
const actionListeners = new Set<(action: BrowserAction) => void>();

function boundedMetadataText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
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
    .join("")
    .trim()
    .slice(0, max);
}

/**
 * An ordinary CSS colour literal, or nothing.
 *
 * This string is written straight into a stylesheet, and it arrives from
 * outside the app — so it is matched against the shapes a colour actually has
 * rather than merely checked for semicolons. `url(...)`, `var(...)` and
 * anything else that could carry a request or a lookup are simply not colours.
 */
function cssColor(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const value = raw.trim();
  if (!value || value.length > 32) return undefined;
  const hex = /^#[0-9a-f]{3,8}$/i;
  const fn = /^rgba?\(\s*[\d.\s%,/]+\)$/i;
  const hsl = /^hsla?\(\s*[\d.\s%,/deg]+\)$/i;
  return hex.test(value) || fn.test(value) || hsl.test(value)
    ? value
    : undefined;
}

function normalizeContext(raw: unknown): BrowserEmbedContext | null {
  const value = raw as {
    embedded?: unknown;
    theme?: unknown;
    frame?: unknown;
  } | null;
  if (value?.embedded !== true) return null;
  const frame = cssColor(value.frame);
  return {
    embedded: true,
    theme: value.theme === "dark" ? "dark" : "light",
    ...(frame ? { frame } : {}),
  };
}

function applyContext(next: BrowserEmbedContext): void {
  context = next;
  if (typeof document !== "undefined") {
    document.documentElement.toggleAttribute(
      "data-browser-embedded",
      next.embedded,
    );
    if (next.embedded) document.documentElement.dataset.theme = next.theme;
    // Both surfaces, because the companion shows both: the thread paints on
    // `--app-main` and the panes around it on `--app-sidebar`, and leaving
    // either one behind is a seam across the middle of the panel.
    if (next.embedded && next.frame) {
      document.documentElement.style.setProperty("--app-main", next.frame);
      document.documentElement.style.setProperty("--app-sidebar", next.frame);
    }
  }
  for (const listener of contextListeners) listener();
}

/**
 * Something the embedding browser's sidebar asked for on the user's behalf.
 *
 * The browser draws the conversation list but holds no Chat credentials, so
 * pinning and removing can only be REQUESTS — this app is the one that performs
 * them. (Starting a chat is not one of these: the browser opens the New chat
 * PAGE in a dialog of its own.)
 */
export interface BrowserAction {
  type: "pin" | "unpin" | "remove";
  conversationId?: string;
}

function normalizeAction(raw: unknown): BrowserAction | null {
  const value = raw as { type?: unknown; conversationId?: unknown } | null;
  const type = value?.type;
  if (type !== "pin" && type !== "unpin" && type !== "remove") return null;
  const conversationId = boundedMetadataText(value?.conversationId, 160);
  if (!conversationId) return null;
  return { type, ...(conversationId ? { conversationId } : {}) };
}

export function installBrowserEmbedBridge(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.uglyBrowser?.onContext?.((raw) => {
    const next = normalizeContext(raw);
    if (next) applyContext(next);
  });
  window.uglyBrowser?.onAction?.((raw) => {
    const action = normalizeAction(raw);
    if (!action) return;
    // Held, exactly as a selection is: the browser can ask before this app has
    // finished mounting, and a dropped request is a button that did nothing.
    if (actionListeners.size === 0) pendingAction = action;
    else for (const listener of actionListeners) listener(action);
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

/**
 * Hand the embedding browser everything it needs to draw the conversation list.
 *
 * `loaded` is separate from `complete` on purpose. `complete` says the list is
 * not TRUNCATED, which is trivially true of the empty list this holds while
 * `conversationListMine` is still in flight — and the browser, reading it as
 * "this is the whole list", used to stop waiting and tear this guest down
 * before the real answer arrived, reporting "No active conversations" to people
 * with a sidebar full of them. `loaded` is the one that says the request came
 * back, so an empty list can finally be told apart from an unfinished one.
 */
export function onBrowserAction(
  listener: (action: BrowserAction) => void,
): () => void {
  actionListeners.add(listener);
  if (pendingAction) {
    const action = pendingAction;
    pendingAction = null;
    listener(action);
  }
  return () => actionListeners.delete(listener);
}

export function publishBrowserConversations(
  conversations: BrowserConversationMeta[],
  activeConversationId: string | null,
  loaded: boolean,
): void {
  if (!context.embedded) return;
  const seen = new Set<string>();
  const rows: BrowserConversationMeta[] = [];
  for (const row of conversations.slice(0, MAX_CONVERSATIONS)) {
    const id = boundedMetadataText(row.id, 160);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const lastMessage = boundedMetadataText(row.lastMessage, 160);
    // Bounded and stripped exactly like the title beside it: this is rendered
    // inside the browser's own chrome, not inside this app.
    const image =
      typeof row.image === "string" ? row.image.trim().slice(0, 512) : "";
    rows.push({
      id,
      title: boundedMetadataText(row.title, 120) || "Conversation",
      unread: Number.isFinite(row.unread)
        ? Math.max(0, Math.min(999, Math.trunc(row.unread)))
        : 0,
      ...(row.pinned ? { pinned: true } : {}),
      ...(lastMessage ? { lastMessage } : {}),
      ...(image ? { image } : {}),
    });
  }
  const active = boundedMetadataText(activeConversationId, 160);
  window.uglyBrowser?.publishConversations?.({
    conversations: rows,
    activeConversationId: active && seen.has(active) ? active : null,
    complete: conversations.length <= MAX_CONVERSATIONS,
    loaded,
  });
}

/**
 * Tell the embedding browser which conversation this page just started — or,
 * with an empty id, that the user closed it without starting one.
 *
 * The browser owns the dialog this page is shown in, so it is the one that
 * closes it and opens the thread; navigating here instead would leave the new
 * conversation sitting in a dialog nobody meant to keep.
 */
export function publishCreatedConversation(conversationId: string): void {
  if (!context.embedded) return;
  window.uglyBrowser?.publishCreatedConversation?.(
    boundedMetadataText(conversationId, 160),
  );
}

export function resetBrowserEmbedForTests(): void {
  context = DEFAULT_CONTEXT;
  installed = false;
  pendingSelection = null;
  pendingAction = null;
  actionListeners.clear();
  contextListeners.clear();
  selectionListeners.clear();
}
