import React, { useEffect, useState } from 'react';
import { useAppOptional } from 'ugly-app/client';
import { useRouter } from '../router';
import { Sidebar } from './Sidebar';

const SIDEBAR_MIN_WIDTH = 820;

// Two-pane app shell: persistent conversation sidebar (desktop) + main pane.
// Non-chat routes (landing, test pages) render full-width with no shell.
export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
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
  const isChat = rn === ':conversationId' || (rn === '' && authed);

  const [wide, setWide] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= SIDEBAR_MIN_WIDTH));
  useEffect(() => {
    const onResize = (): void => setWide(window.innerWidth >= SIDEBAR_MIN_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!isChat) {
    // The landing ('' when logged out) is full-bleed (its dark bg fills behind
    // the notch) and applies its own safe-area insets, so render it bare.
    if (rn === '') return <>{children}</>;
    // Utility pages (search, bot editor, group settings, user) — inset on every
    // side so headers clear the notch and content clears the home indicator.
    return (
      <div
        style={{
          height: '100dvh',
          boxSizing: 'border-box',
          overflow: 'hidden',
          background: 'var(--app-main)',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
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
  const shellBg = rn === '' ? 'var(--app-sidebar)' : 'var(--app-main)';
  return (
    <div
      style={{
        display: 'flex',
        height: '100dvh',
        width: '100%',
        overflow: 'hidden',
        background: shellBg,
        boxSizing: 'border-box',
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {wide && authed ? <Sidebar /> : null}
      <main style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>{children}</main>
    </div>
  );
}
