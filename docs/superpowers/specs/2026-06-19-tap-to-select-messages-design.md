# Tap-to-Select Message Redesign — ugly.chat

**Date:** 2026-06-19
**Status:** Approved design, ready for implementation plan

## Goal

Make the chat thread cleaner by default and mobile-first. Two changes:

1. Add more breathing room between the last message and the composer.
2. Hide per-message metadata (timestamp, telemetry, read status) and the action
   menu behind a **tap-to-select** interaction. Because tap is now overloaded for
   images (which previously opened a fullscreen viewer on tap), images instead open
   the viewer on **long-press**, and expose an explicit **"Open" button when their
   message is selected**.

## Affected files

- `client/styles.css` — composer padding; selected-state styling.
- `client/pages/ChatPage.tsx` — owns the new `selectedMessageId` state; `MessageBody`
  switches from `hover` to `isSelected`; reveals metadata/menu on select.
- `client/components/VirtualMessageList.tsx` — clears selection on user scroll.
- `client/components/ChatMedia.tsx` — `ChatImage` long-press to open + Open-button
  when selected; remove tap-opens-viewer.

## Decisions (from brainstorming)

- **Scope:** Universal tap/click-select on all platforms. The current mouse-`hover`
  reveal is removed entirely (not kept as a desktop-only path).
- **Selection:** Single selected message at a time, auto-clearing. Tapping another
  message moves selection; tapping the selected message again, tapping empty space,
  or scrolling clears it.
- **Sender name:** Stays always visible. Only timestamp, telemetry, read status, and
  the action menu hide behind selection.

## 1. Composer breathing room

Increase `padding-bottom` on `[data-testid='message-list-inner']` from `12px` to
`24px`. Note there are two rules setting this padding in `styles.css` (≈line 611 =
`10px`, and ≈line 646 = `12px`, the latter being the more specific `.uc-chat-scroll`
selector that wins). Set the effective value to `24px`. Pure spacing; no logic.

## 2. Selection state model

A single `selectedMessageId: string | null` lives in `ChatPage` (already owns
`messages` and `renderMessage`). Threaded into `MessageBody` as:

- `isSelected: boolean`
- `onSelect: (id: string) => void` — toggles: select if not selected, clear if it is.

Behavior:

- **Click/tap a message bubble (or an image's message)** → `onSelect(msg.id)`.
- The existing `hover` state, `onMouseEnter`/`onMouseLeave`, and `hideTimer` in
  `MessageBody` are removed. The action menu now renders on `isSelected`.
- Tapping a different message moves selection (single-select is enforced because
  state holds one id).
- **Clear on scroll:** `VirtualMessageList` gains an optional `onUserScroll?: () => void`
  prop. Inside the existing `handleScroll`, when `!programmaticRef.current` (i.e. a
  real user scroll, not auto-follow) it calls `onUserScroll`. `ChatPage` passes a
  handler that clears `selectedMessageId`. This reuses the existing programmatic-scroll
  gate so new-message auto-follow does not clear selection.
- **Clear on tap-outside:** a click on the scroll/empty area (not on a message)
  clears selection. Implemented by clearing in `ChatPage` when a click reaches the
  scroll container background; message clicks `stopPropagation` so they don't also
  trigger the outside-clear.
- **Text-selection guard:** in `onSelect`, if `window.getSelection()` returns a
  non-collapsed range, do nothing — so drag-to-select-text + copy still works on
  desktop without popping the menu.

### Selected visual

The selected message's bubble gets a subtle background tint (a new
`.uc-bubble.selected` rule, e.g. a faint `--app-tertiary`/ring treatment consistent
with existing tokens) so it's clear which message is active.

## 3. What selection reveals

Currently-always-on elements become conditional on `isSelected`:

- **Peer timestamp** — the `<span className="t">{clock(msg.created)}</span>` in the
  `uc-metarow`. The sender name stays; only the time is gated.
- **Own footer** — the `delivered · HH:MM` `uc-receipt` block (`isOwn && !humanStatsOn`).
- **Bot telemetry receipt** — model / latency / tokens / cost `uc-receipt`.
- **Human-DM read-status receipt** — seen / delivered / double-texted / replied-in.

The action menu overlay (reactions, read-aloud, copy, pin, edit, delete) renders when
`isSelected` (same absolute placement it used for `hover`: `top: -34, right: -4`).

Always-visible regardless of selection: sender name, reaction pills (counts), bot
buttons, link previews, the `(edited)` marker.

## 4. Images

In `ChatImage` (`client/components/ChatMedia.tsx`):

- **Remove** the `onClick={() => onOpen(...)}` direct-open and the `cursor: zoom-in`
  default.
- **Long-press to open:** pointer-down starts a ~450ms timer (cancelled if the
  pointer moves beyond a small threshold or lifts early). On fire, call `onOpen` and
  set a flag so the subsequent `click` is suppressed (preventing message-select).
- **Plain tap** (short press, no long-press fired) bubbles up to select the message,
  same as tapping the bubble — `ChatImage` gains an `onSelect?` callback (or relies on
  the click propagating to the message's click handler).
- **Open button when selected:** `ChatImage` gains an `isSelected` prop. When true, a
  small "Open" button (lucide icon + label, existing button styling) overlays a corner
  of the image; tapping it calls `onOpen`. This is the discoverable / desktop path so
  no long-press is required. `MessageBody` passes `isSelected` through to each
  `ChatImage`.

The `ImageZoomViewer` itself is unchanged.

## Testing

- **Padding:** visual / snapshot — last message clears the composer with more gap.
- **Selection:** tap selects (metadata + menu appear); tap again clears; tap another
  moves; scroll clears; tap-outside clears; drag-selecting text does NOT select.
- **Metadata gating:** timestamp / telemetry / read-status hidden by default, shown
  when selected; sender name always shown.
- **Images:** long-press opens viewer and does not select; short tap selects; Open
  button appears only when message selected and opens viewer; existing
  `tests/` Playwright flows for image open updated to the new gestures.

## Out of scope

- No change to message data model, server, or `ImageZoomViewer` internals.
- No multi-select / bulk actions.
- No change to reactions, buttons, or link-preview rendering.
