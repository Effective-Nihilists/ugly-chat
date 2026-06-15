# Visual Restyle + Remove Backgrounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app match the approved mockups: hybrid-Ugly chrome (square panels, 1px hairlines, mono labels, JetBrains Mono token), neutral **gray** avatars, gray lucide reactions, and **remove per-chat custom backgrounds** entirely.

**Architecture:** Add a `--app-font-mono` token + a small set of shared utility classes to `client/styles.css` (ported from `mockups/brand.css`). Restyle `Sidebar`, `ConversationRow`, and the `ChatPage` message/header/composer JSX to the mockup look. Neutralize `Avatar` so initials render gray instead of the rainbow palette. Strip the `background`/`backgroundUrl` plumbing from `ChatPage`, `BotEditPage`, `bots.ts`, `shared/collections.ts`, and `shared/api.ts`.

**Tech Stack:** React (ugly-app/client), CSS custom properties, lucide-react, vitest.

> Visual source of truth: `mockups/conversation-list.html` and `mockups/chat.html`. Port class names/values from `mockups/brand.css`. Pure CSS/JSX changes are verified by running the app (node-env vitest can't render them); logic changes (avatar color, schema) are unit-tested.

---

### Task 1: Add mono token + shared brand utility classes

**Files:**
- Modify: `client/styles.css` (`:root` block ~line 60, and append utility classes at end)

- [ ] **Step 1: Add the mono font token** to `:root` (after `--app-font-body`), and to each theme block from Plan 01 where it differs (vim/cosmic-latte already set heading/body; add mono there too — vim mono = JetBrains Mono, latte mono = JetBrains Mono):

```css
--app-font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace;
```

Ensure `JetBrains Mono` is in the font import (Plan 01 added the others). Append `JetBrains+Mono:wght@400;500;600;700` to the Google Fonts link if absent.

- [ ] **Step 2: Append shared utility classes** at the end of `client/styles.css`, ported from `mockups/brand.css` (the `.mono-label`, `.receipt`, `.pill`, `.daysep`, `.telemetry` look). Use the repo's `--app-*` token names:

```css
/* ---- brand utilities (ported from mockups/brand.css) ---- */
.uc-mono-label { font-family: var(--app-font-mono); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.22em; color: var(--app-foreground-muted); }
.uc-receipt { font-family: var(--app-font-mono); font-size: 10.5px; letter-spacing: 0.02em; color: var(--app-foreground-muted); display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.uc-receipt .cost { color: var(--app-primary); }
.uc-receipt .dot { color: var(--app-border); }
.uc-pill { display: inline-flex; align-items: center; gap: 7px; padding: 7px 13px; border: 1.5px solid var(--app-primary); color: var(--app-primary); background: transparent; font-family: var(--app-font-mono); font-size: 11.5px; font-weight: 600; cursor: pointer; }
.uc-pill:hover { background: var(--app-primary); color: var(--app-on-primary); }
```

- [ ] **Step 3: Verify build**

Run: `npm run build` — expect success.

- [ ] **Step 4: Commit**

```bash
git add client/styles.css client/index.html
git commit -m "feat(restyle): add mono token + brand utility classes"
```

---

### Task 2: Neutralize avatar color (TDD)

**Files:**
- Modify: `client/lib/conversations.tsx:70-123` (`avatarColor` + `Avatar`)
- Test: `tests/unit/avatar.test.ts`

The mockups use a single neutral gray for avatar initials (no rainbow, no orange bot badge). Keep the `Avatar` API; change the fill.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/avatar.test.ts
import { describe, it, expect } from 'vitest';
import { avatarColor } from '../../client/lib/conversations';

describe('avatarColor', () => {
  it('returns the neutral elevated-surface token for every seed', () => {
    expect(avatarColor('anything')).toBe('var(--app-tertiary)');
    expect(avatarColor('bot-ugly')).toBe('var(--app-tertiary)');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — current impl returns a hex from the rainbow palette.

Run: `npx vitest run tests/unit/avatar.test.ts`

- [ ] **Step 3: Implement** — replace the palette + function at `client/lib/conversations.tsx:70-75`:

```tsx
// Avatars are neutral gray (brand: no rainbow, no orange bot badge). Identity
// comes from the initial + the name beside it, not color.
export function avatarColor(_seed: string): string {
  return 'var(--app-tertiary)';
}
```

Then in the `Avatar` fallback `<div>` (lines 105-122), change `color: '#fff'` to `color: 'var(--app-foreground-muted)'`, add `border: '1px solid var(--app-border)'`, and `borderRadius: '50%'` → keep round (mockup list avatars are round; only chrome is square). Keep `background: avatarColor(props.seed)`.

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run tests/unit/avatar.test.ts`

- [ ] **Step 5: Commit**

```bash
git add client/lib/conversations.tsx tests/unit/avatar.test.ts
git commit -m "feat(restyle): neutral gray avatars"
```

---

### Task 3: Remove per-chat backgrounds — schema + API + bot config

**Files:**
- Modify: `shared/collections.ts` (`ConversationSchema:22` drop `background`; `BotSchema:163` drop `backgroundUrl`; `UserConversationSchema:117` drop `background`)
- Modify: `shared/api.ts` (`botCreate` input ~line 327 drop `backgroundUrl`; any `botUpdate` similarly)
- Modify: `client/lib/bots.ts` (`BotDoc:20` drop `backgroundUrl`; `startBotChat:49` drop `background`)
- Test: `tests/unit/no-background.test.ts`

- [ ] **Step 1: Write a guard test** that the schemas no longer accept/emit a background field as a known key:

```ts
// tests/unit/no-background.test.ts
import { describe, it, expect } from 'vitest';
import { ConversationSchema, BotSchema } from '../../shared/collections';

describe('backgrounds removed', () => {
  it('Conversation schema has no declared background key', () => {
    expect(Object.keys((ConversationSchema as any).shape)).not.toContain('background');
  });
  it('Bot schema has no declared backgroundUrl key', () => {
    expect(Object.keys((BotSchema as any).shape)).not.toContain('backgroundUrl');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** Run: `npx vitest run tests/unit/no-background.test.ts`

- [ ] **Step 3: Delete the fields.**
  - `shared/collections.ts`: remove the `background:` line from `ConversationSchema` and `UserConversationSchema`, and the `backgroundUrl:` line from `BotSchema`. (`.catchall(z.unknown())` means old docs with the field still parse — no migration needed.)
  - `shared/api.ts`: remove `backgroundUrl: z.string().nullable().optional(),` from `botCreate` (and `botUpdate` if present).
  - `client/lib/bots.ts`: remove `backgroundUrl` from `BotDoc` (line 20) and remove `background: bot.backgroundUrl ?? null,` from the `conversationCreate` call (line 49).

- [ ] **Step 4: Run, expect PASS.** Run: `npx vitest run tests/unit/no-background.test.ts`

- [ ] **Step 5: Commit**

```bash
git add shared/collections.ts shared/api.ts client/lib/bots.ts tests/unit/no-background.test.ts
git commit -m "feat(restyle): drop per-chat background from schema/api/bot config"
```

---

### Task 4: Remove background rendering from ChatPage

**Files:**
- Modify: `client/pages/ChatPage.tsx` (lines 442, 464, 594-610, 118-130, 175-182, 914, 928, 938, 947-950, 953, 1058)

- [ ] **Step 1: Strip the `bgUrl` state + fetch.**
  - Delete `const [bgUrl, setBgUrl] = useState<string | null>(null);` (442) and `setBgUrl(null);` (464).
  - In the profiles effect (594-610), delete the `backgroundUrl` extraction and `setBgUrl(bg)` lines; keep the rest of the profile handling.

- [ ] **Step 2: Remove the `hasBg` prop from `MessageBody`.**
  - In the signature (118-130) delete `hasBg: boolean;`.
  - In the background expression (175-182) delete the `hasBg ? 'var(--app-main)' :` branch so it reads:

```tsx
background:
  msg.color === 'error'
    ? 'var(--app-error)'
    : isOwn
      ? 'var(--app-secondary)'
      : 'var(--app-tertiary)',
```

  - At the call site (928) delete `hasBg={!!bgUrl}`; remove `bgUrl` from the deps array (938).

- [ ] **Step 3: Remove background-aware chrome.**
  - System message (914): replace the `bgUrl ? … : …` ternaries with the plain branch — `color: 'var(--app-foreground)'`, drop `textShadow`.
  - Main container (947-950): replace with `background: 'var(--app-main)'`.
  - Header (953): drop the `bgUrl` conditionals — `borderBottom: '1px solid var(--app-border)'`, remove `background`/`backdropFilter` ternaries.
  - ChatView prop (1058): delete `onImageBackground={!!bgUrl}`.

- [ ] **Step 4: Typecheck + run.** Run: `npm run build` (expect no TS errors about `bgUrl`/`hasBg`).

- [ ] **Step 5: Verify manually.** `npm run dev`, open a bot chat — no background image; bubbles use secondary/tertiary; header has a 1px border. Matches `mockups/chat.html`.

- [ ] **Step 6: Commit**

```bash
git add client/pages/ChatPage.tsx
git commit -m "feat(restyle): remove background rendering from chat"
```

---

### Task 5: Remove the background field from BotEditPage

**Files:**
- Modify: `client/pages/BotEditPage.tsx` (lines 24, 41, 58, 82, 108)

- [ ] **Step 1:** Delete `const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);` (24), `setBackgroundUrl(b.backgroundUrl ?? null);` (41), `backgroundUrl,` from the save payload (58), `backgroundUrl` from the deps array (82), and the `<ImageField label="Background" … />` line (108). Keep the Avatar ImageField.

- [ ] **Step 2: Typecheck.** Run: `npm run build`.

- [ ] **Step 3: Verify manually.** `npm run dev`, open `/bot/new` — only the Avatar image field remains.

- [ ] **Step 4: Commit**

```bash
git add client/pages/BotEditPage.tsx
git commit -m "feat(restyle): remove background upload from bot editor"
```

---

### Task 6: Restyle reactions to gray lucide chips

**Files:**
- Modify: `client/pages/ChatPage.tsx:327-334` (reaction chips) and `355-361` (picker)

Reactions already use lucide icons (good). Change the chip to square, neutral, with the icon in a muted color (matches `mockups/chat.html` `.react`).

- [ ] **Step 1:** Update the chip `<span>` style (327-334) to:

```tsx
<span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--app-font-mono)', fontSize: 10, background: 'var(--app-tertiary)', border: '1px solid var(--app-border)', borderRadius: 0, padding: '2px 8px', color: 'var(--app-foreground-muted)' }}>
  {Icon ? <Icon size={12} /> : r} {n}
</span>
```

(Square corners via `borderRadius: 0`; icon inherits the muted color — no orange.)

- [ ] **Step 2: Verify manually.** `npm run dev`, react to a message — chips are square + gray, not orange/rounded.

- [ ] **Step 3: Commit**

```bash
git add client/pages/ChatPage.tsx
git commit -m "feat(restyle): gray square reaction chips"
```

---

### Task 7: Restyle the conversation list (Sidebar + ConversationRow)

**Files:**
- Modify: `client/components/Sidebar.tsx`, `client/components/ConversationRow.tsx`

Port the look from `mockups/conversation-list.html`: square search field (1px border, no big radius), `.uc-mono-label` section headers (`// pinned`, `// direct`, `// bots`), square unread badge, square avatars-with-1px-border in chrome contexts, active-row 2px left bar in `--app-primary`.

- [ ] **Step 1:** In `ConversationRow.tsx`: the selected left bar (36-48) — change `width: 4, height: 28, borderRadius: 999` to `width: 2, top: 8, bottom: 8, borderRadius: 0` (full-height square bar, matching mockup). Keep the `rgba(var(--app-primary-rgb),0.10)` selected background.

- [ ] **Step 2:** Unread badge — locate the badge span and set `borderRadius: 0`, `fontFamily: 'var(--app-font-mono)'`, `background: 'var(--app-primary)'`, `color: 'var(--app-on-primary)'`.

- [ ] **Step 3:** In `Sidebar.tsx`: the search input wrapper — set `borderRadius: 0`, `border: '1px solid var(--app-border)'`, `background: 'var(--app-tertiary)'`. Add `.uc-mono-label` section headers above pinned/direct/bot groups if the list is grouped (if not grouped today, wrap the single list under one `// conversations` label — keep scope minimal).

- [ ] **Step 4:** Footer buttons (173-184) — set `borderRadius: 0`, `fontFamily: 'var(--app-font-mono)'`, `fontSize: 11`, uppercase, `border: '1px solid var(--app-border)'`.

- [ ] **Step 5: Verify manually.** `npm run dev`, `/chat` ≥820px — compare side-by-side with `mockups/conversation-list.html` (desktop frame). Square chrome, mono labels, 2px active bar.

- [ ] **Step 6: Commit**

```bash
git add client/components/Sidebar.tsx client/components/ConversationRow.tsx
git commit -m "feat(restyle): square-chrome conversation list to match mockup"
```

---

### Task 8: Restyle chat header + composer + bubbles

**Files:**
- Modify: `client/pages/ChatPage.tsx` (header ~953, composer area, MessageBody bubble radii ~175-182)

Port from `mockups/chat.html`: header is 1px-bordered with a `.uc-receipt` status line (`DeepSeek v4 pro · online`), composer uses a 2px `--app-primary` border square box, bubbles get the soft-with-one-square-corner radius.

- [ ] **Step 1:** Bubble radii — in MessageBody set peer bubbles `borderRadius: '14px 14px 14px 3px'` and own bubbles `borderRadius: '14px 14px 3px 14px'` (the squared-corner nod). Keep backgrounds from Task 4.

- [ ] **Step 2:** Header — under the title, render a `<div className="uc-receipt">` line showing the bot model + online state when the conversation has a bot (model available from the `profiles`/bot config already loaded). For human DMs show `online` only.

- [ ] **Step 3:** Composer — wrap the input row in a box with `border: '2px solid var(--app-primary)'`, `borderRadius: 0`, `background: 'var(--app-main)'`, send button square + `background: 'var(--app-primary)'`.

- [ ] **Step 4: Verify manually.** `npm run dev` — chat matches `mockups/chat.html` (minus telemetry, which is Plan 04).

- [ ] **Step 5: Commit**

```bash
git add client/pages/ChatPage.tsx
git commit -m "feat(restyle): chat header/composer/bubbles to match mockup"
```

---

## Self-Review

- Spec coverage: gray avatars ✓ (T2), gray reactions ✓ (T6), remove backgrounds ✓ (T3-T5), square chrome list ✓ (T7), chat header/composer/bubbles ✓ (T8), mono token ✓ (T1).
- Placeholders: none — every step names exact files/lines.
- Type consistency: `avatarColor` signature unchanged (still `(seed) => string`); removing `hasBg` is done at both definition and call site; schema field removals are paired across collections/api/client.
- Migration risk: `.catchall(z.unknown())` keeps old docs valid after field removal — no DB migration. Noted in T3.
- Verification honesty: visual steps are manual (`npm run dev` vs mockup) because vitest runs node-env; logic steps (avatar, schema) are unit-tested.

## Execution Handoff

Plan complete. **(1) Subagent-Driven (recommended)** or **(2) Inline Execution**. Which approach?
