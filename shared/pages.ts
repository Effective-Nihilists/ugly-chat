import { definePage, definePages } from 'ugly-app/shared';

// ─── Pages ────────────────────────────────────────────────────────────────────
// Define every route your app supports here. Each key is a URL path segment.
//
// definePage<Params>(options)
//   Params  – TypeScript type for URL params (path + query string)
//   auth    – require authentication? (default: true)
//
// Path params use Express-style syntax:  'user/:userId'
// Query params are declared in the type but not the key: definePage<{ q?: string }>
//
// After adding a page here, map it to a component in client/allPages.ts.
// Navigate to it from anywhere via: useRouter().push('route-key', params)
export const pages = definePages({
  '': definePage<{}>({ auth: false }),
  'search': definePage<{ q?: string }>({ auth: true }),
  'bot/:botId': definePage<{ botId: string }>({ auth: true }),
  'user/:userId': definePage<{ userId: string }>(),
  'settings/:conversationId': definePage<{ conversationId: string }>({ auth: true }),
  ':conversationId': definePage<{ conversationId: string }>({ auth: true }),
});

export type AppPages = typeof pages;
