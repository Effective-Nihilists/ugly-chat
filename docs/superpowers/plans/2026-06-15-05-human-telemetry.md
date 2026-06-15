# Human Response-Time Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The honest, slightly-rude version of read-receipts on human DMs: a totals strip (`avg reply · fastest · left on read · your share`) and per-message receipts (`replied in 2m 14s`, `left you on read · 3h 12m`, `double-texted ×2`). Gated by the "Response-time stats" toggle from Plan 03.

**Architecture:** Pure, unit-tested reducers in `shared/humanStats.ts` compute everything from the existing `Message` stream (each message already has `created`, `userId`, `isBot`). No new persistence — stats are derived client-side from the loaded message list + `conversationReadState` (`viewed` timestamps). A `HumanTelemetryStrip` renders totals; `MessageBody` renders the per-message line. Reuses the `.telemetry`/`.uc-receipt` styles from Plan 04.

**Tech Stack:** TypeScript, React, vitest.

> Verified facts: `Message` has `created`, `userId`, `isBot`; `conversationReadState` returns `{ readers: {userId, viewed}[] }`. Settings toggle persisted at `uc-conv-<id>-responseStats` (Plan 03). Visual source: `mockups/chat-human.html`.

---

### Task 1: Duration formatter (TDD)

**Files:**
- Create: `shared/duration.ts`
- Test: `tests/unit/duration.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/unit/duration.test.ts
import { describe, it, expect } from 'vitest';
import { formatDuration } from '../../shared/duration';
describe('formatDuration', () => {
  it('formats sub-minute as seconds', () => { expect(formatDuration(8000)).toBe('8s'); });
  it('formats minutes+seconds', () => { expect(formatDuration(134000)).toBe('2m 14s'); });
  it('formats hours+minutes', () => { expect(formatDuration(11520000)).toBe('3h 12m'); });
  it('clamps negatives to 0s', () => { expect(formatDuration(-5)).toBe('0s'); });
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/unit/duration.test.ts`

- [ ] **Step 3: Implement**

```ts
// shared/duration.ts
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
```

- [ ] **Step 4: Run, expect PASS.** `npx vitest run tests/unit/duration.test.ts`
- [ ] **Step 5: Commit** — `git commit -m "feat(human-stats): duration formatter"`

---

### Task 2: Conversation stats reducer (TDD)

**Files:**
- Create: `shared/humanStats.ts`
- Test: `tests/unit/humanStats.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/unit/humanStats.test.ts
import { describe, it, expect } from 'vitest';
import { computeHumanStats, type StatMsg } from '../../shared/humanStats';

// me = 'u_me', them = 'u_dana'. timestamps in ms.
const msgs: StatMsg[] = [
  { userId: 'u_me',   created: 0 },
  { userId: 'u_me',   created: 1000 },     // double-text (no reply between)
  { userId: 'u_dana', created: 8000 },     // dana replies 7s after my last
  { userId: 'u_me',   created: 20000 },
  { userId: 'u_dana', created: 20000 + 134000 }, // dana replies 2m14s later
];

describe('computeHumanStats', () => {
  const s = computeHumanStats(msgs, 'u_me');
  it('counts messages per side and your share', () => {
    expect(s.myCount).toBe(3);
    expect(s.theirCount).toBe(2);
    expect(s.yourSharePct).toBe(60); // 3/5
  });
  it('computes their avg + fastest reply to me', () => {
    expect(s.theirFastestMs).toBe(7000);
    expect(s.theirAvgReplyMs).toBe((7000 + 134000) / 2);
  });
  it('counts my double-texts (consecutive mine with no reply)', () => {
    expect(s.myDoubleTexts).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/unit/humanStats.test.ts`

- [ ] **Step 3: Implement**

```ts
// shared/humanStats.ts
export interface StatMsg { userId: string; created: number }

export interface HumanStats {
  myCount: number; theirCount: number; yourSharePct: number;
  theirAvgReplyMs: number; theirFastestMs: number; myDoubleTexts: number;
}

// A "reply" = a message from the other side whose immediately-preceding message
// was from me. Reply latency = their.created - myLast.created.
export function computeHumanStats(msgs: StatMsg[], meId: string): HumanStats {
  const sorted = [...msgs].sort((a, b) => a.created - b.created);
  let myCount = 0, theirCount = 0, myDoubleTexts = 0;
  const replyGaps: number[] = [];
  let prevMineAt: number | null = null;
  let lastSenderMine = false;
  for (const m of sorted) {
    const mine = m.userId === meId;
    if (mine) {
      myCount++;
      if (lastSenderMine) myDoubleTexts++;
      prevMineAt = m.created;
      lastSenderMine = true;
    } else {
      theirCount++;
      if (lastSenderMine && prevMineAt != null) replyGaps.push(m.created - prevMineAt);
      lastSenderMine = false;
    }
  }
  const total = myCount + theirCount;
  const theirAvgReplyMs = replyGaps.length ? Math.round(replyGaps.reduce((a, b) => a + b, 0) / replyGaps.length) : 0;
  const theirFastestMs = replyGaps.length ? Math.min(...replyGaps) : 0;
  return {
    myCount, theirCount,
    yourSharePct: total ? Math.round((myCount / total) * 100) : 0,
    theirAvgReplyMs, theirFastestMs, myDoubleTexts,
  };
}

// Per-message: latency of THIS message if it's a reply to the other side.
export function replyLatencyMs(sorted: StatMsg[], index: number, meId: string): number | null {
  const m = sorted[index];
  if (!m || index === 0) return null;
  const prev = sorted[index - 1];
  if (prev.userId === m.userId) return null;        // not a reply (same sender)
  return m.created - prev.created;
}
```

- [ ] **Step 4: Run, expect PASS.** `npx vitest run tests/unit/humanStats.test.ts`
- [ ] **Step 5: Commit** — `git commit -m "feat(human-stats): conversation + per-message reducers"`

---

### Task 3: Human totals strip

**Files:**
- Create: `client/components/HumanTelemetryStrip.tsx`
- Modify: `client/pages/ChatPage.tsx` (render for human DMs when the toggle is on)

- [ ] **Step 1: Build the strip** (reuses `.uc-telemetry`/`.uc-tel-cell` from Plan 04; values use `formatDuration`):

```tsx
// client/components/HumanTelemetryStrip.tsx
import React from 'react';
import { computeHumanStats, type StatMsg } from '../../shared/humanStats';
import { formatDuration } from '../../shared/duration';

export function HumanTelemetryStrip({ msgs, meId, leftOnRead }: { msgs: StatMsg[]; meId: string; leftOnRead: number }): React.ReactElement {
  const s = computeHumanStats(msgs, meId);
  const cell = (k: string, v: React.ReactNode, accent = false) => (
    <div className="uc-tel-cell"><span className="k">{k}</span><span className={`v${accent ? ' cost' : ''}`}>{v}</span></div>
  );
  return (
    <div className="uc-telemetry">
      {cell('avg reply', s.theirAvgReplyMs ? formatDuration(s.theirAvgReplyMs) : '—')}
      {cell('fastest', s.theirFastestMs ? formatDuration(s.theirFastestMs) : '—')}
      {cell('left on read', `${leftOnRead}×`, true)}
      {cell('your share', `${s.yourSharePct}%`, true)}
      <span className="uc-tel-note">the data doesn't lie</span>
    </div>
  );
}
```

- [ ] **Step 2:** In `ChatPage`, when the conversation is a human DM (no bot) and `localStorage['uc-conv-<id>-responseStats'] !== '0'`, render `<HumanTelemetryStrip msgs={messages} meId={userId} leftOnRead={leftOnReadCount} />`. Compute `leftOnReadCount` from `conversationReadState` (count of my messages whose `created` is older than the other reader's `viewed` while they then sent nothing for >1h — or, for v1, a simpler proxy: number of my messages seen >1h before their next reply). Keep the proxy simple and documented inline.

- [ ] **Step 3: Verify manually.** `npm run dev`, open a human DM with history → strip shows real avg/fastest/share. Toggle off in settings → strip hides. Matches `mockups/chat-human.html`.
- [ ] **Step 4: Commit** — `git commit -m "feat(human-stats): response-time totals strip"`

---

### Task 4: Per-message human receipt

**Files:**
- Modify: `client/pages/ChatPage.tsx` (MessageBody — human DM footer)

- [ ] **Step 1:** When in a human DM (no `msg.telemetry`, conversation has no bot) and stats are enabled, render a footer per message:
  - their message that replied to me: `replied in <dur>` (`.cost` color if <30s → "personal best" style), and if that gap was >1h, render `left you on read · <dur>` in `.cost`.
  - my message: `seen` / `delivered` (from read-state) and, when it began a consecutive run, `double-texted ×N`.

Compute with `replyLatencyMs(sorted, index, userId)`; derive `sorted` once (memoized) from `messages`.

```tsx
{!hasBot && statsOn ? (
  <div className="uc-receipt" style={{ padding: '0 4px', color: 'var(--app-foreground-muted)' }}>
    {(() => {
      const lat = replyLatencyMs(sorted, idx, userId);
      if (!isOwn && lat != null) {
        return lat > 3600_000
          ? <span className="cost">left you on read · {formatDuration(lat)}</span>
          : <span>replied in {formatDuration(lat)}{lat < 30000 ? ' · personal best' : ''}</span>;
      }
      return <span>{seen ? 'seen' : 'delivered'}</span>;
    })()}
  </div>
) : null}
```

(`idx`/`sorted`/`hasBot`/`statsOn`/`seen` are threaded from the map in the parent — add them to `MessageBody` props.)

- [ ] **Step 2: Verify manually.** `npm run dev`, human DM — reply lines show real latencies; a >1h gap shows "left you on read" in orange. Matches `mockups/chat-human.html`.
- [ ] **Step 3: Commit** — `git commit -m "feat(human-stats): per-message response-time receipts"`

---

## Self-Review

- Spec coverage: avg reply / fastest / your-share ✓ (T2/T3), left-on-read ✓ (T3/T4), replied-in / double-texted ✓ (T2/T4), toggle-gated ✓ (T3/T4).
- Placeholders: none — `leftOnRead` uses a simple, explicitly-documented proxy for v1 (no schema change); the reducer is fully tested.
- Type consistency: `StatMsg`/`HumanStats` defined once; `replyLatencyMs` shares the sorted array; `formatDuration` reused from Plan-05 Task 1.
- Honesty: all numbers derive from real timestamps; nothing is invented. Disabled by default-respecting the settings toggle.

## Execution Handoff

Plan complete. **(1) Subagent-Driven (recommended)** or **(2) Inline Execution**. Which approach?
