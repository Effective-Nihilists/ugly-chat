export type ThemeId = 'auto' | 'light' | 'dark' | 'cosmic-latte' | 'vim';

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'cosmic-latte', label: 'Latte' },
  { id: 'vim', label: 'Vim' },
];

const KEY = 'uglychat-theme';
const IDS = new Set(THEMES.map((t) => t.id));

export function normalizeTheme(value: string | null | undefined): ThemeId {
  return value && IDS.has(value as ThemeId) ? (value as ThemeId) : 'auto';
}

export function loadTheme(): ThemeId {
  if (typeof window === 'undefined') return 'auto';
  return normalizeTheme(window.localStorage.getItem(KEY));
}

export function saveTheme(theme: ThemeId): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(KEY, theme);
}

export function applyThemeAttr(el: HTMLElement, theme: ThemeId): void {
  if (theme === 'auto') el.removeAttribute('data-theme');
  else el.dataset.theme = theme;
}

export function applyTheme(theme: ThemeId): void {
  if (typeof document !== 'undefined') applyThemeAttr(document.documentElement, theme);
}
