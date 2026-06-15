import { bootstrapApp, FeedbackButton } from 'ugly-app/client';
import { requests } from '../shared/api';
import en from '../shared/lang/en';
import { stringsDef } from '../shared/strings';
import { AppShell } from './components/AppShell';
import { RouterProvider, RouterView } from './router';
import './styles.css';
import { loadTheme, applyTheme } from './lib/theme';

// Apply persisted theme ASAP so first paint is correct (auto = no attribute → OS media query).
applyTheme(loadTheme());

bootstrapApp({
  requests,
  // Apex domain (ugly.chat) — adopt an existing ugly.bot session silently.
  silentSso: true,
  RouterProvider,
  render: () => (
    <>
      <AppShell>
        <RouterView />
      </AppShell>
      <FeedbackButton />
    </>
  ),
  strings: {
    defaultLang: stringsDef.defaultLang,
    langs: stringsDef.langs,
    defaultTable: en as unknown as Record<string, string>,
    loadTable: async (lang) => {
      const mod = await import(`../shared/lang/${lang}.ts`) as { default: Record<string, string> };
      return mod.default;
    },
  },
});
