import React, { useEffect, useState } from 'react';
import { useAppOptional } from 'ugly-app/client';
import { useRouter } from '../router';
import { Sidebar } from './Sidebar';

const CHAT_ROUTES = new Set(['chat', 'chat/:conversationId']);
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
  const isChat = CHAT_ROUTES.has(router.current.routeName);

  const [wide, setWide] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= SIDEBAR_MIN_WIDTH));
  useEffect(() => {
    const onResize = (): void => setWide(window.innerWidth >= SIDEBAR_MIN_WIDTH);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!isChat) return <>{children}</>;

  return (
    <div style={{ display: 'flex', height: '100dvh', width: '100%', overflow: 'hidden', background: 'var(--app-main)' }}>
      {wide && authed ? <Sidebar /> : null}
      <main style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>{children}</main>
    </div>
  );
}
