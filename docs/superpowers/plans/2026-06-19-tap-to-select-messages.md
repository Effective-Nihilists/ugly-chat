# Tap-to-Select Message Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ugly.chat's thread cleaner and mobile-first by adding composer breathing room and hiding per-message metadata + actions behind a single tap-to-select interaction, with long-press / Open-button to view images.

**Architecture:** A single `selectedMessageId` state in `ChatPage` drives everything. A framework-free helper computes the next selection (toggle/move/clear). `MessageBody` renders timestamp, telemetry, read-status, and the action menu only when its message `isSelected` (replacing the old mouse-`hover` mechanism). `VirtualMessageList` clears selection on user scroll. `ChatImage` opens the zoom viewer on long-press or via an Open button shown when selected, instead of on plain tap.

**Tech Stack:** React 18 (function components), TypeScript (strict, `noExplicitAny`), Vite, vitest (node env — pure logic only; no component-render harness exists), plain CSS in `client/styles.css`, lucide icon nodes via the existing `Icon` pattern.

## Global Constraints

- **No `any` types** — `noExplicitAny` is enforced project-wide.
- **No emojis in UI** — render lucide core `IconNode` via the existing small SVG `Icon`/lucide-react-style imports already used in this file (e.g. `Check`, `X`, `Copy`, `Pin` from `lucide-react`). Match the file's existing import style.
- **Test env is node** — vitest cannot render React here. Pure helpers get vitest unit tests; React/DOM wiring is verified manually via `npm run dev` (no component-test harness exists in this repo, matching established patterns).
- **Follow existing style** — inline styles + `uc-*` CSS classes as already used in `ChatPage.tsx` / `styles.css`. Use CSS custom properties (`var(--app-*)`) for all colors.
- **TypeScript check command:** `npx tsc --noEmit` must pass after each code task.
- **Unit test command:** `npm test` (vitest run).

---

### Task 1: Composer breathing room

**Files:**
- Modify: `client/styles.css` (the `[data-testid='message-list-inner']` rules — one at ~line 611 `padding-bottom: 10px`, and the more specific `.uc-chat-scroll [data-testid='message-list-inner']` at ~line 646 `padding-bottom: 12px`).

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (CSS only).

- [ ] **Step 1: Increase the base inner padding**

In `client/styles.css`, find the first rule:

```css
[data-testid='message-list-inner'] {
  width: 100%;
  max-width: 820px;
  margin-left: auto;
  margin-right: auto;
  padding-left: 16px;
  padding-right: 16px;
  /* Breathing room so the last message isn't flush against the composer. */
  padding-bottom: 10px;
  box-sizing: border-box;
}
```

Change `padding-bottom: 10px;` to `padding-bottom: 24px;`.

- [ ] **Step 2: Increase the specific (winning) inner padding**

Find the second rule:

```css
.uc-chat-scroll [data-testid='message-list-inner'] {
  width: 100%;
  max-width: 820px;
  margin-left: auto;
  margin-right: auto;
  padding-bottom: 12px;
}
```

Change `padding-bottom: 12px;` to `padding-bottom: 24px;`.

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: no errors (CSS change doesn't affect TS, this just confirms a clean baseline).

- [ ] **Step 4: Manual verification**

Run: `npm run dev`, open a conversation, scroll to the bottom.
Expected: a visibly larger gap (~24px) between the last message and the composer input.

- [ ] **Step 5: Commit**

```bash
git add client/styles.css
git commit -m "feat(chat): more breathing room between last message and composer"
```

---

### Task 2: Selection-state helper (pure, TDD)

**Files:**
- Create: `client/lib/messageSelection.ts`
- Test: `tests/unit/messageSelection.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `nextSelectedId(current: string | null, tappedId: string): string | null` — returns `null` when `tappedId === current` (toggle off), otherwise returns `tappedId` (select or move). This is the single source of truth for the toggle/move/clear rule used by `ChatPage` in Task 3.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/messageSelection.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextSelectedId } from '../../client/lib/messageSelection';

describe('nextSelectedId', () => {
  it('selects a message when nothing is selected', () => {
    expect(nextSelectedId(null, 'm1')).toBe('m1');
  });
  it('moves selection to a different message', () => {
    expect(nextSelectedId('m1', 'm2')).toBe('m2');
  });
  it('toggles off when the selected message is tapped again', () => {
    expect(nextSelectedId('m1', 'm1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- messageSelection`
Expected: FAIL — cannot find module `../../client/lib/messageSelection`.

- [ ] **Step 3: Write minimal implementation**

Create `client/lib/messageSelection.ts`:

```ts
/**
 * Single-select toggle rule for the chat thread. Tapping the already-selected
 * message clears it; tapping any other message selects (or moves to) it.
 */
export function nextSelectedId(current: string | null, tappedId: string): string | null {
  return current === tappedId ? null : tappedId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- messageSelection`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add client/lib/messageSelection.ts tests/unit/messageSelection.test.ts
git commit -m "feat(chat): add single-select toggle helper for messages"
```

---

### Task 3: Selection state in ChatPage + gate metadata/menu in MessageBody

**Files:**
- Modify: `client/pages/ChatPage.tsx` — add `selectedMessageId` state; thread `isSelected` + `onSelect` into `MessageBody`; replace `hover` with `isSelected`; gate the timestamp / own-footer / telemetry / read-status blocks on `isSelected`; add a click handler with a text-selection guard.
- Modify: `client/styles.css` — add a `.uc-bubble.selected` tint rule.

**Interfaces:**
- Consumes: `nextSelectedId` from `client/lib/messageSelection` (Task 2).
- Produces: `MessageBody` now accepts `isSelected: boolean` and `onSelect: (id: string) => void` props (consumed by Task 4's scroll-clear wiring and Task 5's image props, which read `isSelected`).

- [ ] **Step 1: Import the helper and add selection state**

In `client/pages/ChatPage.tsx`, add the import near the other relative imports (e.g. by the `ChatMedia` import on line 8):

```ts
import { nextSelectedId } from '../lib/messageSelection';
```

Inside the `ChatPage` component body, next to the existing UI state (near `const [menuOpen, setMenuOpen] = useState(false);` ~line 603), add:

```ts
const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
const selectMessage = useCallback((id: string) => {
  // Don't hijack a click that is really a text drag-selection (desktop copy).
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed && sel.toString().length > 0) return;
  setSelectedMessageId((cur) => nextSelectedId(cur, id));
}, []);
```

- [ ] **Step 2: Extend the `MessageBody` props type**

In the `MessageBody` props object type (starts line 143), add two fields after `onOpenImage: (src: string, alt: string) => void;`:

```ts
  isSelected: boolean;
  onSelect: (id: string) => void;
```

And add them to the destructure on line 164-165:

```ts
  const { msg, isOwn, sender, firstOfRun, stacked, daySep, onReact, onDelete, onEdit, onPin, pinned, onButton,
    onOpenImage, isSelected, onSelect, humanIdx, humanSorted, humanMeId, humanStatsOn, humanSeen } = props;
```

- [ ] **Step 3: Remove the hover mechanism, add tap-to-select on the column**

Delete the hover state and timer in `MessageBody` (lines ~167-172):

```ts
  const [hover, setHover] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hideTimer.current) clearTimeout(hideTimer.current); }, []);
```

Replace the `.uc-msgcol` opening tag (lines ~229-234) — drop `onMouseEnter`/`onMouseLeave`, add an `onClick` that selects. `stopPropagation` so the thread-background clear handler (Task 4) doesn't immediately re-clear this same click:

```tsx
        <div
          className="uc-msgcol"
          onClick={(e) => { e.stopPropagation(); onSelect(msg.id); }}
          style={{ position: 'relative' }}
        >
```

(If `useEffect`/`useRef` become unused after this, leave their imports — they are still used elsewhere in the file. Run tsc in Step 8 to confirm no unused-symbol errors within `MessageBody` itself; if the linter flags the now-unused `hover` references, ensure every `hover` usage below is replaced in Steps 4-5.)

- [ ] **Step 4: Gate the peer timestamp on selection**

Find the peer metarow (lines ~236-241):

```tsx
          {!isOwn && firstOfRun ? (
            <div className="uc-metarow">
              <span className={`sender${sender.isBot ? ' bot' : ''}`}>{sender.name}</span>
              <span className="t">{clock(msg.created)}</span>
            </div>
          ) : null}
```

Gate only the time span (keep the name always visible):

```tsx
          {!isOwn && firstOfRun ? (
            <div className="uc-metarow">
              <span className={`sender${sender.isBot ? ' bot' : ''}`}>{sender.name}</span>
              {isSelected ? <span className="t">{clock(msg.created)}</span> : null}
            </div>
          ) : null}
```

- [ ] **Step 5: Gate telemetry, own footer, human-DM receipt, and the action menu on selection**

a) Add the selected tint to the bubble className (line ~244). Change:

```tsx
            className={`uc-bubble ${isOwn ? 'own' : 'peer'}${stacked ? ' stack' : ''}${isError ? ' err' : ''}${mediaBubble ? ' media' : ''}`}
```

to append `selected` when selected:

```tsx
            className={`uc-bubble ${isOwn ? 'own' : 'peer'}${stacked ? ' stack' : ''}${isError ? ' err' : ''}${mediaBubble ? ' media' : ''}${isSelected ? ' selected' : ''}`}
```

b) Telemetry receipt (line ~398) — change the condition from:

```tsx
      {(msg as { telemetry?: MsgTelemetry }).telemetry ? (
```

to:

```tsx
      {isSelected && (msg as { telemetry?: MsgTelemetry }).telemetry ? (
```

c) Own `delivered · HH:MM` footer (line ~412) — change:

```tsx
      {isOwn && !humanStatsOn && hasText ? (
```

to:

```tsx
      {isSelected && isOwn && !humanStatsOn && hasText ? (
```

d) Human-DM receipt (line ~419) — change:

```tsx
      {humanStatsOn && humanSorted && humanIdx != null && humanMeId != null ? (
```

to:

```tsx
      {isSelected && humanStatsOn && humanSorted && humanIdx != null && humanMeId != null ? (
```

e) Action menu (lines ~458-459) — change the gate from `hover` to `isSelected`, AND add `onClick={(e) => e.stopPropagation()}` to the menu container so clicking a menu button (react/copy/pin/edit/delete) does NOT bubble to the column's onClick and toggle the message off:

```tsx
      {isSelected ? (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: -34,
            right: -4,
            ...
```

(The `{hover ? (` opening on line 458 changes to `{isSelected ? (`, and the `onClick` is added to the existing menu `<div>`. The menu's button children are otherwise unchanged.)

f) Bot starter buttons (the `buttons.length > 0` block, ~line 367) — these live inside `.uc-msgcol`, so add `e.stopPropagation()` inside their existing `onClick` so sending a starter prompt doesn't also toggle the bot message's selection. Change the button `onClick` (line ~374):

```tsx
              onClick={(e) => {
                e.stopPropagation();
                if (b.uri) window.open(b.uri, '_blank', 'noopener');
                else if (b.prompt) onButton(b.prompt);
              }}
```

- [ ] **Step 6: Pass the new props from `renderMessage`**

In `renderMessage` (the `<MessageBody ... />` JSX ~line 1206), add after `onOpenImage={openImage}`:

```tsx
          isSelected={selectedMessageId === msg.id}
          onSelect={selectMessage}
```

Add `selectedMessageId` and `selectMessage` to the `useCallback` dependency array of `renderMessage` (the array ending ~line 1218):

```ts
    [messages, userId, handleReact, handleDelete, handleEdit, handlePin, pinnedMessageId, handleSend, profiles,
      hasBot, statsOn, statMsgs, readers, getUser, openImage, selectedMessageId, selectMessage],
```

- [ ] **Step 7: Add the selected-bubble CSS tint**

In `client/styles.css`, near the other `.uc-bubble` rules, add:

```css
/* Selected message — subtle ring so the active row reads clearly while its
   metadata + action menu are revealed. */
.uc-bubble.selected {
  box-shadow: 0 0 0 2px var(--app-primary);
}
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors. (If an unused-import error appears for a symbol whose last use you removed, delete that specific import.)

- [ ] **Step 9: Manual verification**

Run: `npm run dev`, open a bot conversation and a human DM.
Expected:
- By default no timestamps, no telemetry receipt, no `delivered`/`seen` footer, no action menu — but sender names still show.
- Tapping a message reveals its timestamp + telemetry/read-status footer + action menu, and tints the bubble.
- Tapping the same message again clears it; tapping another moves the reveal; only one message is ever selected.
- On desktop, drag-selecting text inside a bubble does NOT pop the menu (copy still works).

- [ ] **Step 10: Commit**

```bash
git add client/pages/ChatPage.tsx client/styles.css
git commit -m "feat(chat): tap-to-select reveals message metadata + actions"
```

---

### Task 4: Clear selection on user scroll and tap-outside

**Files:**
- Modify: `client/components/VirtualMessageList.tsx` — add optional `onUserScroll` + `onBackgroundClick` props; call `onUserScroll` from `handleScroll` on real (non-programmatic) scrolls; attach `onBackgroundClick` to the scroll container's `onClick`.
- Modify: `client/pages/ChatPage.tsx` — pass both handlers (each clears `selectedMessageId`) to `VirtualMessageList`.

**Interfaces:**
- Consumes: `setSelectedMessageId` from Task 3 (and the column-level `stopPropagation` added in Task 3 step 3, which keeps message taps from reaching `onBackgroundClick`).
- Produces: `VirtualMessageListProps.onUserScroll?: () => void` and `onBackgroundClick?: () => void`.

- [ ] **Step 1: Add the props to the interface**

In `client/components/VirtualMessageList.tsx`, in `VirtualMessageListProps` (line ~33), add after `bottom?: ReactNode;`:

```ts
  /** Fired on a user-initiated scroll (not programmatic auto-follow). */
  onUserScroll?: () => void;
  /** Fired when the user clicks the thread background (not a message). */
  onBackgroundClick?: () => void;
```

- [ ] **Step 2: Destructure the props**

In the component signature (line ~51-58), add both to the destructure:

```ts
export function VirtualMessageList({
  messages,
  currentUserId,
  renderItem,
  hasMore,
  onLoadMore,
  bottom,
  onUserScroll,
  onBackgroundClick,
}: VirtualMessageListProps) {
```

- [ ] **Step 3: Call it from `handleScroll`**

In `handleScroll` (line ~138), the early-return already filters programmatic scrolls (`if (!el || programmaticRef.current) return;`). After that guard, add the callback as the first line of the real-scroll body:

```ts
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || programmaticRef.current) return;
    onUserScroll?.();
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = dist <= BOTTOM_THRESHOLD;
    setShowButton(dist > SCROLL_BUTTON_THRESHOLD);
    if (el.scrollTop < LOAD_MORE_THRESHOLD && hasMore && !isLoadingMoreRef.current) {
      isLoadingMoreRef.current = true;
      prevScrollHeightRef.current = el.scrollHeight;
      onLoadMore();
    }
  }, [hasMore, onLoadMore, onUserScroll]);
```

(Add `onUserScroll` to the dependency array as shown.)

- [ ] **Step 4: Attach the background-click handler to the scroll container**

In the same file, the scroll container `<div ref={scrollRef} ...>` (lines ~173-178) gets an `onClick`. Because message columns call `stopPropagation` (Task 3 step 3), only clicks on the empty thread background reach here:

```tsx
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onClick={() => onBackgroundClick?.()}
        data-testid="conversation-scroll-container"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
```

- [ ] **Step 5: Wire both handlers from `ChatPage`**

In `client/pages/ChatPage.tsx`, on the `<VirtualMessageList ... />` (line ~1489), add after `onLoadMore={...}`:

```tsx
          onUserScroll={() => setSelectedMessageId(null)}
          onBackgroundClick={() => setSelectedMessageId(null)}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev`, open a conversation with enough history to scroll.
Expected:
- Select a message (menu/metadata appear), then scroll the thread — selection clears.
- Select a message, then tap an empty gap in the thread — selection clears.
- Tapping a menu button (react/copy/pin) keeps the message selected (does not clear).
- Sending a new message (auto-follow scroll) while a different message is selected does NOT clear it spuriously (programmatic scrolls are gated out).

- [ ] **Step 8: Commit**

```bash
git add client/components/VirtualMessageList.tsx client/pages/ChatPage.tsx
git commit -m "feat(chat): clear message selection on user scroll and tap-outside"
```

---

### Task 5: Image gestures — long-press to open, Open button when selected

**Files:**
- Modify: `client/components/ChatMedia.tsx` — `ChatImage` gains `isSelected` prop; remove tap-opens-viewer; add long-press-to-open with click suppression; add the Open button overlay when selected.
- Modify: `client/pages/ChatPage.tsx` — pass `isSelected` to each `<ChatImage>` in `MessageBody` (both the edge-to-edge and centered map calls).

**Interfaces:**
- Consumes: `MessageBody`'s `isSelected` (Task 3); `onOpen: (src, alt) => void` (existing `onOpenImage`).
- Produces: `ChatImage` prop signature gains `isSelected: boolean`. Plain tap on an image no longer opens the viewer — it propagates to the message's `onClick` (Task 3) and selects the message.

- [ ] **Step 1: Add `isSelected` to the `ChatImage` props and import the icon**

In `client/components/ChatMedia.tsx`, extend the import on line 20:

```ts
import { X, Maximize2 } from 'lucide-react';
```

Change the `ChatImage` signature (lines ~46-56) to add `isSelected`:

```tsx
export function ChatImage({
  src,
  alt,
  edgeToEdge,
  onOpen,
  isSelected,
}: {
  src: string;
  alt: string;
  edgeToEdge: boolean;
  onOpen: (src: string, alt: string) => void;
  isSelected: boolean;
}): React.ReactElement {
```

- [ ] **Step 2: Add long-press detection state**

Inside `ChatImage`, after the `const [ar, setAr] = useState<number | null>(null);` line (~57), add:

```tsx
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFiredRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const cancelPress = useCallback(() => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    longFiredRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    cancelPress();
    pressTimer.current = setTimeout(() => {
      longFiredRef.current = true;
      onOpen(src, alt);
    }, 450);
  }, [cancelPress, onOpen, src, alt]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = startRef.current;
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancelPress();
  }, [cancelPress]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    // If a long-press already opened the viewer, swallow the trailing click so
    // it doesn't also select the message.
    if (longFiredRef.current) {
      e.preventDefault();
      e.stopPropagation();
      longFiredRef.current = false;
    }
  }, []);
```

(Ensure `useRef` and `useCallback` are in the React import at the top of the file — they already are: line 19 imports `useCallback, useEffect, useRef, useState`.)

- [ ] **Step 3: Rewire the image element and add the Open button**

Replace the returned JSX (lines ~73-95) with:

```tsx
  return (
    <div style={{ ...wrap, position: 'relative' }}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        draggable={false}
        onLoad={(e) => {
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          if (w > 0 && h > 0) setAr(w / h);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onClickCapture={onClickCapture}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          maxHeight: TALL_MAX_H,
          objectFit: 'contain',
          cursor: 'pointer',
          borderRadius: edgeToEdge ? 0 : 8,
          touchAction: 'manipulation',
        }}
      />
      {isSelected ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(src, alt); }}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'var(--app-font-mono)',
            fontSize: 11,
            fontWeight: 600,
            padding: '5px 9px',
            border: '1px solid var(--app-border)',
            borderRadius: 6,
            background: 'var(--app-main)',
            color: 'var(--app-foreground)',
            cursor: 'pointer',
            boxShadow: 'var(--app-shadow-button-default)',
          }}
        >
          <Maximize2 size={13} /> Open
        </button>
      ) : null}
    </div>
  );
```

- [ ] **Step 4: Pass `isSelected` from `MessageBody`'s `ChatImage` calls**

In `client/pages/ChatPage.tsx`, both `<ChatImage>` usages (lines ~301 and ~316) get `isSelected={isSelected}`:

```tsx
                  <ChatImage key={`${im.url}-${i}`} src={im.url} alt={im.alt} edgeToEdge onOpen={onOpenImage} isSelected={isSelected} />
```

and

```tsx
                  <ChatImage key={`${im.url}-${i}`} src={im.url} alt={im.alt} edgeToEdge={false} onOpen={onOpenImage} isSelected={isSelected} />
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, open a conversation containing an image message (or send one).
Expected:
- A short tap on an image selects its message (metadata + menu appear) and does NOT open the viewer.
- A long press (~0.5s) on the image opens the fullscreen `ImageZoomViewer` and does NOT also select the message.
- When the image's message is selected, an "Open" button shows in the image's top-right; tapping it opens the viewer.
- Pan/zoom inside the viewer still works (unchanged).

- [ ] **Step 7: Commit**

```bash
git add client/components/ChatMedia.tsx client/pages/ChatPage.tsx
git commit -m "feat(chat): long-press / Open-button to view images under tap-to-select"
```

---

### Task 6: Full regression check

**Files:** none (verification only).

- [ ] **Step 1: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Unit tests**

Run: `npm test`
Expected: all pass, including the new `messageSelection` tests.

- [ ] **Step 3: Lint**

Run: `npx eslint client/pages/ChatPage.tsx client/components/ChatMedia.tsx client/components/VirtualMessageList.tsx client/lib/messageSelection.ts`
Expected: no errors (no `any`, no unused symbols, no emoji literals).

- [ ] **Step 4: Manual smoke across message types**

Run: `npm run dev`. In a bot conversation and a human DM, confirm: default-clean thread (names only), tap reveals metadata+menu, single-select + toggle + move, scroll clears, tap-outside clears (tap an empty gap in the thread), reactions/buttons/link-previews always visible, image short-tap selects, long-press opens, Open-button opens, composer gap is larger.

- [ ] **Step 5: Final commit (if any lint/type fixups were needed)**

```bash
git add -A
git commit -m "chore(chat): tap-to-select redesign cleanup"
```

---

## Notes for the implementer

- **Tap-outside-to-clear** is an explicit handler (Task 4 step 4): the scroll container's `onClick` clears selection, and message columns `stopPropagation` (Task 3 step 3) so a message tap never reaches it. Both scroll and background-tap clear selection.
- **Why the text-selection guard lives in `ChatPage.selectMessage`** and not the helper: `window.getSelection()` is DOM-only and untestable in the node vitest env, so it stays out of the pure helper (Task 2).
- **Propagation model:** the column's `onClick` toggles selection. Anything inside the column that should NOT toggle it must `stopPropagation`: the action-menu container (Task 3 step 5e) and the bot starter buttons (Task 3 step 5f). The image Open button (Task 5) already does. A plain image tap intentionally does NOT stop propagation — it bubbles to the column and selects the message.
