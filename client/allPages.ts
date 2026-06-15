import { lazyPage } from 'ugly-app/client';
import type { PageMap } from 'ugly-app/shared';
import type { AppPages } from '../shared/pages';

// ─── Page Map ─────────────────────────────────────────────────────────────────
// Maps every route key defined in shared/pages.ts to a lazy-loaded component.
// The `satisfies PageMap<AppPages>` ensures keys stay in sync at compile time.
//
// lazyPage(() => import('./pages/MyPage'))
//   – code-splits the page into its own chunk, loaded on first navigation
//
// For pages that need a custom loader (data fetching before render), use
// lazyPageLoader() instead and export a `loader` function from the page file.
//
// When you add a route in shared/pages.ts, add the matching entry here.
export const allPages = {
  ['']: lazyPage(() => import('./pages/HomePage')),
  ['chat']: lazyPage(() => import('./pages/ChatHomePage')),
  ['chat/:conversationId']: lazyPage(() => import('./pages/ChatPage')),
  ['bots']: lazyPage(() => import('./pages/BotsPage')),
  ['bot/:botId']: lazyPage(() => import('./pages/BotEditPage')),
  ['user/:userId']: lazyPage(() => import('./pages/UserPage')),
  ['search']: lazyPage(() => import('./pages/SearchPage')),
  ['new']: lazyPage(() => import('./pages/NewChatPage')),
  ['new-group']: lazyPage(() => import('./pages/NewGroupPage')),
  ['settings/:conversationId']: lazyPage(() => import('./pages/ChatSettingsPage')),
  ['settings']: lazyPage(() => import('./pages/SettingsPage')),
} satisfies PageMap<AppPages>;
