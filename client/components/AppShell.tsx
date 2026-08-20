import React, { useEffect, useState } from "react";
import { useAppOptional } from "ugly-app/client";
import { useRouter } from "../router";
import { Sidebar } from "./Sidebar";
import { clearBrowserShare, useBrowserShare } from "../lib/browserShare";
import { MessageSquare, X } from "lucide-react";
import {
  deleteOrLeaveConversation,
  resolveImageUrl,
  useConversations,
} from "../lib/conversations";
import {
  onBrowserAction,
  onBrowserConversationSelection,
  publishBrowserConversations,
  useBrowserEmbed,
} from "../lib/browserEmbed";

const SIDEBAR_MIN_WIDTH = 820;

// Two-pane app shell: persistent conversation sidebar (desktop) + main pane.
// Non-chat routes (landing, test pages) render full-width with no shell.
export function AppShell({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const router = useRouter();
  // The Sidebar calls useApp() (socket/userId), which only exists inside the
  // AppProvider — mounted ONLY when authenticated. When logged out (or the
  // session token expired), the framework renders the app WITHOUT AppProvider
  // and shows its system LoginPopup in the main pane; rendering the Sidebar
  // anyway threw "useApp must be used inside AppProvider" and white-screened
  // the whole page. Gate the shell chrome on auth (useAppOptional → null when
  // unauthenticated) so the login screen renders cleanly instead.
  const authed = useAppOptional() !== null;
  // The chat two-pane shell applies to any conversation route and to the
  // logged-IN root (which renders ChatHomePage). A logged-OUT root ('' →
  // landing) bypasses the shell so HomePage renders full-width/scrollable.
  const rn = router.current.routeName;
  const isChat = rn === ":conversationId" || (rn === "" && authed);
  const browserShare = useBrowserShare();
  const embed = useBrowserEmbed();

  const [wide, setWide] = useState(() =>
    typeof window === "undefined"
      ? true
      : !embed.embedded && window.innerWidth >= SIDEBAR_MIN_WIDTH,
  );
  useEffect(() => {
    const onResize = (): void => {
      setWide(!embed.embedded && window.innerWidth >= SIDEBAR_MIN_WIDTH);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [embed.embedded]);

  if (!isChat) {
    // The landing ('' when logged out) is full-bleed (its dark bg fills behind
    // the notch) and applies its own safe-area insets, so render it bare.
    if (rn === "") return <>{children}</>;
    // Utility pages (search, bot editor, group settings, user) — inset on every
    // side so headers clear the notch and content clears the home indicator.
    return (
      <div
        style={{
          height: "100dvh",
          boxSizing: "border-box",
          overflow: "hidden",
          background: "var(--app-main)",
          paddingTop: "var(--safe-area-inset-top, 0px)",
          paddingBottom: "var(--safe-area-inset-bottom, 0px)",
          paddingLeft: "var(--safe-area-inset-left, 0px)",
          paddingRight: "var(--safe-area-inset-right, 0px)",
        }}
      >
        {children}
      </div>
    );
  }

  // Chat two-pane: inset top + sides here; the bottom is owned per-surface (the
  // composer needs a keyboard-aware inset, the sidebar pads its own footer).
  // The inset (notch/edge) background must match the page filling it: the home
  // list ('') is `--app-sidebar`, a conversation is `--app-main`.
  const shellBg = rn === "" ? "var(--app-sidebar)" : "var(--app-main)";
  return (
    <div
      style={{
        display: "flex",
        height: "100dvh",
        width: "100%",
        overflow: "hidden",
        background: shellBg,
        boxSizing: "border-box",
        paddingTop: "var(--safe-area-inset-top, 0px)",
        paddingLeft: "var(--safe-area-inset-left, 0px)",
        paddingRight: "var(--safe-area-inset-right, 0px)",
      }}
    >
      {browserShare ? (
        <div
          className="uc-browser-share"
          role="status"
          data-id="browser-share-notice"
        >
          <MessageSquare size={15} />
          <span>
            Choose a conversation for <strong>{browserShare.title}</strong>
          </span>
          <button
            type="button"
            aria-label="Cancel page share"
            onClick={clearBrowserShare}
            data-id="cancel-browser-share"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}
      {authed ? <BrowserConversationBridge /> : null}
      {wide && authed ? <Sidebar /> : null}
      <main
        style={{ flex: 1, minWidth: 0, height: "100%", overflow: "hidden" }}
      >
        {children}
      </main>
    </div>
  );
}

function BrowserConversationBridge(): React.ReactElement | null {
  const router = useRouter();
  // Mounted only when authed (see its render), so the context is there — but
  // read optionally anyway, because this component's whole job is to be safe to
  // mount early.
  const app = useAppOptional();
  const socket = app?.socket;
  const userId = app?.userId ?? "";
  const embed = useBrowserEmbed();
  const { conversations, loading } = useConversations();
  const activeConversationId =
    router.current.routeName === ":conversationId"
      ? router.current.params.conversationId
      : null;

  useEffect(() => {
    if (!embed.embedded) return;
    publishBrowserConversations(
      conversations.map((row) => {
        // The same two fields the sidebar row beside it draws from: the
        // denormalized last-message preview, and the avatar/group image already
        // resolved to a URL (the browser holds no Chat credentials, so it
        // cannot resolve one itself). Both omitted rather than sent undefined —
        // a row with no artwork must fall back to its letter plate, not to a
        // broken <img>.
        const image = resolveImageUrl(row.image);
        return {
          id: row.conversationId,
          title: row.title,
          unread: row.unread,
          ...(row.pinned ? { pinned: true } : {}),
          ...(row.preview ? { lastMessage: row.preview } : {}),
          ...(image ? { image } : {}),
        };
      }),
      activeConversationId,
      // NOT `conversations.length > 0` — an account with no chats has genuinely
      // loaded an empty list, and conflating the two is what left the browser
      // waiting on a list that had already arrived.
      !loading,
    );
  }, [activeConversationId, conversations, loading, embed.embedded]);

  useEffect(
    () =>
      onBrowserConversationSelection((conversationId) => {
        router.push(":conversationId", { conversationId });
      }),
    [router],
  );

  // ── What the browser's sidebar asked for ──
  //
  // It draws the conversation list but holds no Chat credentials, so pin,
  // remove and "new chat" arrive here as requests. Each one is the SAME call
  // this app's own sidebar makes, deliberately: a second implementation of
  // "delete, or leave if you do not own it" is a second set of rules about
  // somebody's conversations.
  //
  // The list refreshes itself either way — `useConversations` is subscribed to
  // `conversationUser` — so nothing here republishes by hand.
  useEffect(
    () =>
      onBrowserAction((action) => {
        if (!socket) return;
        const conversationId = action.conversationId;
        if (!conversationId) return;
        if (action.type === "remove") {
          void deleteOrLeaveConversation(socket, conversationId, userId).catch(
            (err: unknown) => {
              console.error("[browser-action] remove failed", err);
            },
          );
          return;
        }
        void socket
          .request("conversationSetPinned", {
            conversationId,
            pinned: action.type === "pin",
          })
          .catch((err: unknown) => {
            console.error("[browser-action] pin failed", err);
          });
      }),
    [router, socket, userId],
  );

  return null;
}
