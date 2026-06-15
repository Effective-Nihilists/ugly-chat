# Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-selectable theme (auto / dark / light / cosmic-latte / vim) that persists, defaulting to `auto` (follows OS), copied from Ugly Studio's palettes.

**Architecture:** Move `client/styles.css` from `@media (prefers-color-scheme: dark)`-only theming to attribute-scoped themes: `:root[data-theme='<name>']` blocks plus a single `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { … } }` for `auto`. A tiny `client/lib/theme.ts` module reads/writes `localStorage['uglychat-theme']` and sets `document.documentElement.dataset.theme`. A `ThemePicker` component (sidebar footer) switches it. The token values are lifted verbatim from `app/youtube/.../mockups/brand.css` and `ugly-studio/client/styles.css`.

**Tech Stack:** TypeScript, CSS custom properties, React (ugly-app/client), vitest.

---

### Task 1: Theme module (pure logic, TDD)

**Files:**
- Create: `client/lib/theme.ts`
- Test: `tests/unit/theme.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/theme.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { THEMES, normalizeTheme, applyThemeAttr } from '../../client/lib/theme';

describe('theme', () => {
  it('lists the five themes with auto first', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['auto', 'light', 'dark', 'cosmic-latte', 'vim']);
  });
  it('normalizes unknown values to auto', () => {
    expect(normalizeTheme('nope')).toBe('auto');
    expect(normalizeTheme('vim')).toBe('vim');
    expect(normalizeTheme(null)).toBe('auto');
  });
  it('removes the data-theme attribute for auto, sets it otherwise', () => {
    const el = { dataset: {} as Record<string, string>, removeAttribute: vi.fn(() => { delete (el.dataset as Record<string,string>).theme; }) } as unknown as HTMLElement;
    applyThemeAttr(el, 'vim');
    expect(el.dataset.theme).toBe('vim');
    applyThemeAttr(el, 'auto');
    expect(el.removeAttribute).toHaveBeenCalledWith('data-theme');
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `npx vitest run tests/unit/theme.test.ts`
Expected: FAIL — cannot resolve `../../client/lib/theme`.

- [ ] **Step 3: Implement the module**

```ts
// client/lib/theme.ts
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
```

- [ ] **Step 4: Run it, expect PASS**

Run: `npx vitest run tests/unit/theme.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/lib/theme.ts tests/unit/theme.test.ts
git commit -m "feat(theme): add theme module with persistence + attribute apply"
```

---

### Task 2: Rework styles.css into attribute-scoped themes

**Files:**
- Modify: `client/styles.css:1-130` (the `:root` block and the `@media (prefers-color-scheme: dark)` block)

Current state (verified): `:root` holds the light tokens (`--app-primary:#ff5500`, `--app-main:#fff`, `--app-foreground:#000`, …) and a `@media (prefers-color-scheme: dark) { :root { … } }` overrides them. We keep light as the base `:root`, and add explicit theme blocks. Token values come from `ugly-studio/client/styles.css` (dark/cosmic-latte/vim) mapped onto the `--app-*` names this app uses.

- [ ] **Step 1: Convert the dark media query to auto-only**

Change the opening selector at `client/styles.css:100` from:

```css
@media (prefers-color-scheme: dark) {
  :root {
```

to:

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
```

(Leave the dark token body unchanged. This makes OS-dark apply **only** when no explicit theme is set = `auto`.)

- [ ] **Step 2: Add an explicit dark block** (so picking "Dark" works regardless of OS). Insert after the closing `}` of the media query (~line 131):

```css
:root[data-theme='dark'] {
  --app-primary: #ff5500; --app-primary-rgb: 255, 85, 0;
  --app-secondary: #1a1d23; --app-secondary-rgb: 26, 29, 35;
  --app-tertiary: #141720; --app-tertiary-rgb: 20, 23, 32;
  --app-sidebar: #1e2128; --app-main: #0f1115; --app-main-rgb: 15, 17, 21;
  --app-border: #2a2d35; --app-border-rgb: 42, 45, 53;
  --app-foreground: #ffffff; --app-foreground-rgb: 255, 255, 255;
  --app-input: #12141a; --app-error: #e3120b; --app-error-rgb: 227, 18, 11;
  --app-foreground-10: rgba(255,255,255,0.1); --app-foreground-20: rgba(255,255,255,0.2);
  --app-foreground-50: rgba(255,255,255,0.5); --app-foreground-60: rgba(255,255,255,0.6);
  --app-foreground-80: rgba(255,255,255,0.8); --app-primary-20: rgba(255,85,0,0.2);
  --app-error-20: rgba(227,18,11,0.2); --app-foreground-muted: rgba(255,255,255,0.55);
  --app-gradient-default: linear-gradient(135deg, #282d36 0%, #1a1d23 100%);
  --app-gradient-debug: linear-gradient(135deg, #2a2832 0%, #1e1c26 100%);
}
```

- [ ] **Step 3: Add the cosmic-latte block** (warm cream + serif; values from `ugly-studio/client/styles.css:187-237`):

```css
:root[data-theme='cosmic-latte'] {
  --app-font-heading: 'Playfair Display', 'Cormorant Garamond', Georgia, serif;
  --app-font-body: 'Cormorant Garamond', 'EB Garamond', Georgia, serif;
  --app-font-body-weight: 500; --app-font-body-weight-bold: 700;
  --app-primary: #ff5500; --app-primary-rgb: 255, 85, 0;
  --app-secondary: #f5edd6; --app-secondary-rgb: 245, 237, 214;
  --app-tertiary: #fdf6e3; --app-tertiary-rgb: 253, 246, 227;
  --app-sidebar: #f5edd6; --app-main: #fff8e7; --app-main-rgb: 255, 248, 231;
  --app-border: #e6dcc0; --app-border-rgb: 230, 220, 192;
  --app-foreground: #3a342a; --app-foreground-rgb: 58, 52, 42;
  --app-input: #fffdf5; --app-error: #a44a3a; --app-error-rgb: 164, 74, 58;
  --app-foreground-10: rgba(58,52,42,0.1); --app-foreground-20: rgba(58,52,42,0.2);
  --app-foreground-50: rgba(58,52,42,0.5); --app-foreground-60: rgba(58,52,42,0.6);
  --app-foreground-80: rgba(58,52,42,0.8); --app-primary-20: rgba(255,85,0,0.2);
  --app-error-20: rgba(164,74,58,0.2); --app-foreground-muted: rgba(58,52,42,0.55);
}
```

Also add the webfonts to the existing Google Fonts `@import`/`<link>` (find the font import near the top of `styles.css` or in `client/index.html`; append families `Cormorant+Garamond:ital,wght@0,500;0,600;1,600`, `Playfair+Display:wght@700`, `Space+Mono:wght@400;700`). If fonts load via `index.html`, edit there.

- [ ] **Step 4: Add the vim block** (phosphor green; values from `ugly-studio/client/styles.css:257-311`):

```css
:root[data-theme='vim'] {
  --app-font-heading: 'Space Mono', 'JetBrains Mono', monospace;
  --app-font-body: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  --app-primary: #15d34c; --app-primary-rgb: 21, 211, 76;
  --app-secondary: #0a0a0a; --app-secondary-rgb: 10, 10, 10;
  --app-tertiary: #050505; --app-tertiary-rgb: 5, 5, 5;
  --app-sidebar: #0a0a0a; --app-main: #000000; --app-main-rgb: 0, 0, 0;
  --app-border: #0fa83b; --app-border-rgb: 15, 168, 59;
  --app-foreground: #15d34c; --app-foreground-rgb: 21, 211, 76;
  --app-input: #0a0a0a; --app-error: #ff4444; --app-error-rgb: 255, 68, 68;
  --app-foreground-10: rgba(21,211,76,0.1); --app-foreground-20: rgba(21,211,76,0.2);
  --app-foreground-50: rgba(21,211,76,0.5); --app-foreground-60: rgba(21,211,76,0.6);
  --app-foreground-80: rgba(21,211,76,0.8); --app-primary-20: rgba(21,211,76,0.2);
  --app-error-20: rgba(255,68,68,0.2); --app-foreground-muted: rgba(21,211,76,0.55);
  --app-on-primary: #000000;
}
```

- [ ] **Step 5: Verify build compiles**

Run: `npm run build`
Expected: completes without CSS errors.

- [ ] **Step 6: Commit**

```bash
git add client/styles.css client/index.html
git commit -m "feat(theme): attribute-scoped themes (auto/dark/light/cosmic-latte/vim)"
```

---

### Task 3: Apply persisted theme on boot

**Files:**
- Modify: `client/main.tsx` (the entry that calls `bootstrapApp`)

- [ ] **Step 1: Apply the theme before render**

At the top of `client/main.tsx`, after the imports and before `bootstrapApp({…})`, add:

```ts
import { loadTheme, applyTheme } from './lib/theme';

// Apply persisted theme ASAP so first paint is correct (auto = no attribute → OS media query).
applyTheme(loadTheme());
```

- [ ] **Step 2: Verify manually**

Run: `npm run dev`. In devtools console: `localStorage.setItem('uglychat-theme','vim'); location.reload()`. Expect the app to render phosphor-green. Set back to `auto` → follows OS.

- [ ] **Step 3: Commit**

```bash
git add client/main.tsx
git commit -m "feat(theme): apply persisted theme on boot"
```

---

### Task 4: Theme picker UI

**Files:**
- Create: `client/components/ThemePicker.tsx`
- Modify: `client/components/Sidebar.tsx:173-184` (footer — add a row above the existing button row)

- [ ] **Step 1: Build the picker**

```tsx
// client/components/ThemePicker.tsx
import React, { useState } from 'react';
import { THEMES, loadTheme, saveTheme, applyTheme, type ThemeId } from '../lib/theme';

export function ThemePicker(): React.ReactElement {
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const pick = (id: ThemeId): void => { setTheme(id); saveTheme(id); applyTheme(id); };
  return (
    <div style={{ display: 'flex', gap: 2, padding: '8px 10px', borderTop: '1px solid var(--app-border)', flexWrap: 'wrap' }}>
      {THEMES.map((t) => {
        const on = t.id === theme;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => pick(t.id)}
            style={{
              fontFamily: 'var(--app-font-mono, monospace)', fontSize: 10, letterSpacing: '0.04em',
              padding: '5px 8px', border: `1px solid ${on ? 'var(--app-primary)' : 'transparent'}`,
              color: on ? 'var(--app-primary)' : 'var(--app-foreground-60)',
              background: on ? 'var(--app-primary-20)' : 'transparent', cursor: 'pointer',
            }}
          >
            {t.label.toLowerCase()}
          </button>
        );
      })}
    </div>
  );
}
```

(`--app-font-mono` may not exist yet; the fallback `monospace` is fine, and Plan 02 adds the mono token.)

- [ ] **Step 2: Mount it in the sidebar footer**

In `client/components/Sidebar.tsx`, import `ThemePicker` and render `<ThemePicker />` immediately above the existing footer `<div>` (the Bots / Feedback / All Chats row at lines 173-184).

```tsx
import { ThemePicker } from './ThemePicker';
// …just before the footer button row:
<ThemePicker />
```

- [ ] **Step 3: Verify manually**

Run: `npm run dev`, open `/chat` (desktop width ≥820). The picker shows in the sidebar footer; clicking each chip recolors the app live; reload preserves the choice.

- [ ] **Step 4: Commit**

```bash
git add client/components/ThemePicker.tsx client/components/Sidebar.tsx
git commit -m "feat(theme): theme picker in sidebar footer"
```

---

## Self-Review

- Spec coverage: auto-default ✓ (Task 2 step 1), 4 explicit palettes ✓ (Task 2), persistence ✓ (Task 1+3), picker ✓ (Task 4). Copied from Studio ✓ (values cited).
- Placeholders: none.
- Type consistency: `ThemeId` used identically across module, picker, main.tsx.
- Note: mobile picker placement (sidebar is hidden <820px) is deferred to Plan 03's settings screen, which adds a mobile-reachable Settings entry. Acceptable: desktop ships the picker now; mobile users get OS-auto until Plan 03.

## Execution Handoff

Plan complete. Two options: **(1) Subagent-Driven (recommended)** — fresh subagent per task, review between; **(2) Inline Execution** — executing-plans with checkpoints. Which approach?
