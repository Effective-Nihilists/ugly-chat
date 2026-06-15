# AI Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the bill on screen — per bot message: `model · latency · ↑in ↓out tok · $cost`, and a session-totals strip atop bot conversations: `session · messages · tokens · model · spent`.

**Architecture:** `uglyBotTextGen` currently **discards** the model's usage data. Change it to return `{ text, usage }` where `usage = { model, inputTokens, outputTokens, costUsd, latencyMs }`. Persist that onto the bot `Message` (new optional fields). `MessageBody` renders a `.uc-receipt` footer from the message's telemetry. Session totals are computed by summing telemetry across the conversation's bot messages (a pure reducer, unit-tested) and rendered in a strip below the chat header.

**Tech Stack:** TypeScript, ugly-app server, Zod, React, vitest.

> Verified facts: `server/bots.ts:uglyBotTextGen` (21-59) parses only `content` from the ugly.bot `/request` response and returns a string; `triggerBotReplies` (220-281) calls it and writes the reply via `conversationMessageCreate`. The ugly.bot response envelope may include `usage`/`cost` siblings to `message` — capture whatever is present, default to zeros.
> Visual source of truth: `mockups/chat.html` (`.telemetry` strip + `.rfoot.receipt` per message).

---

### Task 1: Telemetry types + cost/format helpers (TDD)

**Files:**
- Create: `shared/telemetry.ts`
- Test: `tests/unit/telemetry.test.ts`

- [ ] **Step 1: Failing test**

```ts
// tests/unit/telemetry.test.ts
import { describe, it, expect } from 'vitest';
import { formatTokens, formatCost, sumTelemetry, type MsgTelemetry } from '../../shared/telemetry';

describe('telemetry', () => {
  it('formats tokens compactly', () => {
    expect(formatTokens(842)).toBe('842');
    expect(formatTokens(84200)).toBe('84.2k');
  });
  it('formats cost with 3 decimals and a leading $', () => {
    expect(formatCost(0.004)).toBe('$0.004');
    expect(formatCost(0.21)).toBe('$0.21');
    expect(formatCost(0)).toBe('$0.00');
  });
  it('sums a session', () => {
    const msgs: MsgTelemetry[] = [
      { model: 'DeepSeek v4 pro', inputTokens: 118, outputTokens: 1204, costUsd: 0.004, latencyMs: 1400 },
      { model: 'DeepSeek v4 pro', inputTokens: 96, outputTokens: 842, costUsd: 0.003, latencyMs: 900 },
    ];
    const t = sumTelemetry(msgs);
    expect(t.totalTokens).toBe(118 + 1204 + 96 + 842);
    expect(t.totalCostUsd).toBeCloseTo(0.007, 6);
    expect(t.messages).toBe(2);
    expect(t.model).toBe('DeepSeek v4 pro');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/unit/telemetry.test.ts`

- [ ] **Step 3: Implement**

```ts
// shared/telemetry.ts
export interface MsgTelemetry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  return `$${usd < 1 ? usd.toFixed(3) : usd.toFixed(2)}`;
}

export function sumTelemetry(msgs: MsgTelemetry[]): {
  messages: number; totalTokens: number; totalCostUsd: number; model: string;
} {
  let totalTokens = 0, totalCostUsd = 0, model = '';
  for (const m of msgs) {
    totalTokens += (m.inputTokens || 0) + (m.outputTokens || 0);
    totalCostUsd += m.costUsd || 0;
    if (m.model) model = m.model;
  }
  return { messages: msgs.length, totalTokens, totalCostUsd, model };
}
```

- [ ] **Step 4: Run, expect PASS.** `npx vitest run tests/unit/telemetry.test.ts`
- [ ] **Step 5: Commit** — `git commit -m "feat(telemetry): types + token/cost format + session reducer"`

---

### Task 2: Capture usage from ugly.bot in uglyBotTextGen (TDD)

**Files:**
- Modify: `server/bots.ts:21-59` (return `{ text, usage }`)
- Test: `tests/unit/uglyBotTextGen.test.ts`

Refactor so the network call + parsing is testable with an injected fetch. Extract a pure `parseTextGenResponse(json)` and test it.

- [ ] **Step 1: Failing test**

```ts
// tests/unit/uglyBotTextGen.test.ts
import { describe, it, expect } from 'vitest';
import { parseTextGenResponse } from '../../server/bots';

describe('parseTextGenResponse', () => {
  it('extracts text + usage when present', () => {
    const r = parseTextGenResponse({
      message: { content: 'hello' },
      usage: { model: 'deepseek_v4_pro', inputTokens: 118, outputTokens: 1204, costUsd: 0.004 },
    });
    expect(r.text).toBe('hello');
    expect(r.usage).toEqual({ model: 'deepseek_v4_pro', inputTokens: 118, outputTokens: 1204, costUsd: 0.004, latencyMs: 0 });
  });
  it('defaults usage to zeros when absent and joins block arrays', () => {
    const r = parseTextGenResponse({ message: { content: [{ type: 'text', text: 'hi' }] } });
    expect(r.text).toBe('hi');
    expect(r.usage).toEqual({ model: '', inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 });
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run tests/unit/uglyBotTextGen.test.ts`

- [ ] **Step 3: Implement.** In `server/bots.ts`, export a pure parser and make `uglyBotTextGen` return `{ text, usage }`:

```ts
import type { MsgTelemetry } from '../shared/telemetry';

export function parseTextGenResponse(data: any): { text: string; usage: MsgTelemetry } {
  const content = data?.message?.content ?? data?.result?.message?.content;
  let text = '';
  if (typeof content === 'string') text = content.trim();
  else if (Array.isArray(content)) {
    text = content.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('').trim();
  }
  const u = data?.usage ?? data?.result?.usage ?? {};
  const usage: MsgTelemetry = {
    model: String(u.model ?? data?.model ?? ''),
    inputTokens: Number(u.inputTokens ?? u.promptTokens ?? 0),
    outputTokens: Number(u.outputTokens ?? u.completionTokens ?? 0),
    costUsd: Number(u.costUsd ?? u.cost ?? 0),
    latencyMs: 0,
  };
  return { text, usage };
}
```

Then in `uglyBotTextGen`, measure latency around the fetch and return the parsed object:

```ts
async function uglyBotTextGen(model, messages, maxTokens): Promise<{ text: string; usage: MsgTelemetry }> {
  // …existing fetch setup…
  const t0 = Date.now();
  const res = await fetch(/* … */);
  if (!res.ok) throw new Error(`textGen HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`textGen ${data.error}: ${data.detail ?? ''}`);
  const parsed = parseTextGenResponse(data);
  parsed.usage.latencyMs = Date.now() - t0;
  if (!parsed.usage.model) parsed.usage.model = model;
  return parsed;
}
```

(`Date.now()` is allowed in server runtime code — the no-`Date.now` rule is only for Workflow scripts.)

- [ ] **Step 4: Run, expect PASS.** `npx vitest run tests/unit/uglyBotTextGen.test.ts`
- [ ] **Step 5: Commit** — `git commit -m "feat(telemetry): capture model usage from ugly.bot textGen"`

---

### Task 3: Persist telemetry onto bot messages

**Files:**
- Modify: `shared/collections.ts` (`MessageSchema` — add optional `telemetry`)
- Modify: `server/bots.ts:triggerBotReplies` (write telemetry on the reply message)

- [ ] **Step 1: Extend MessageSchema.** Add to the `MessageSchema` object:

```ts
telemetry: z
  .object({
    model: z.string(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    costUsd: z.number(),
    latencyMs: z.number(),
  })
  .optional(),
```

- [ ] **Step 2: Write it on the reply.** In `triggerBotReplies`, capture the usage and pass it through `conversationMessageCreate`:

```ts
let reply = ''; let usage: MsgTelemetry | undefined;
try {
  const out = await uglyBotTextGen(bot.model, [/* …system + history… */], 1200);
  reply = out.text; usage = out.usage;
} catch (err) { /* existing fallback */ }
// …
await conversationMessageCreate(
  { conversationId, message: { text: reply, markdown: reply, onlyUserIds: ['global'], ...(usage ? { telemetry: usage } : {}) } },
  botId,
);
```

(`conversationMessageCreate` input is `.catchall(z.unknown())`, so `telemetry` flows through to the stored doc.)

- [ ] **Step 3: Typecheck + suite.** `npm test` green; `npm run build` clean.
- [ ] **Step 4: Commit** — `git commit -m "feat(telemetry): persist usage on bot messages"`

---

### Task 4: Render per-message receipt footer

**Files:**
- Modify: `client/pages/ChatPage.tsx` (MessageBody — add a footer when `msg.telemetry` exists)

- [ ] **Step 1:** In `MessageBody`, after the bubble (and reactions), render:

```tsx
{msg.telemetry ? (
  <div className="uc-receipt" style={{ padding: '0 4px' }}>
    <b>{msg.telemetry.model || 'model'}</b><span className="dot">·</span>
    {(msg.telemetry.latencyMs / 1000).toFixed(1)}s<span className="dot">·</span>
    ↑{formatTokens(msg.telemetry.inputTokens)} ↓{formatTokens(msg.telemetry.outputTokens)} tok
    <span className="dot">·</span><span className="cost">{formatCost(msg.telemetry.costUsd)}</span>
  </div>
) : null}
```

Import `formatTokens, formatCost` from `../../shared/telemetry`. Ensure `ChatMessage` (the client message type) includes optional `telemetry` — extend it to match the schema field.

- [ ] **Step 2: Verify manually.** `npm run dev`, chat with a bot — each reply shows the receipt footer. Matches `mockups/chat.html`.
- [ ] **Step 3: Commit** — `git commit -m "feat(telemetry): per-message receipt footer"`

---

### Task 5: Session-totals strip

**Files:**
- Create: `client/components/TelemetryStrip.tsx`
- Modify: `client/pages/ChatPage.tsx` (render it below the header for bot conversations)

- [ ] **Step 1: Build the strip** (ported from `mockups/chat.html` `.telemetry`; uses the `.telemetry`/`.cell` classes — add those to `client/styles.css` from `mockups/brand.css`, using `var(--app-font-body)` per the theme-font fix):

```tsx
// client/components/TelemetryStrip.tsx
import React from 'react';
import { sumTelemetry, formatTokens, formatCost, type MsgTelemetry } from '../../shared/telemetry';

export function TelemetryStrip({ telemetry, openedAt }: { telemetry: MsgTelemetry[]; openedAt: number }): React.ReactElement {
  const t = sumTelemetry(telemetry);
  const mins = Math.floor((Date.now() - openedAt) / 60000);
  const cell = (k: string, v: React.ReactNode, cost = false) => (
    <div className="uc-tel-cell"><span className="k">{k}</span><span className={`v${cost ? ' cost' : ''}`}>{v}</span></div>
  );
  return (
    <div className="uc-telemetry">
      {cell('session', `${mins}m`)}
      {cell('messages', String(t.messages))}
      {cell('tokens', formatTokens(t.totalTokens))}
      {cell('model', t.model || '—')}
      {cell('spent', formatCost(t.totalCostUsd), true)}
      <span className="uc-tel-note">billed to your key</span>
    </div>
  );
}
```

Add `.uc-telemetry`, `.uc-tel-cell .k`, `.uc-tel-cell .v`, `.uc-tel-cell .v.cost`, `.uc-tel-note` to `client/styles.css` ported from `mockups/brand.css` `.telemetry` — **labels/values use `var(--app-font-body)`** (the theme-font fix), values `font-variant-numeric: tabular-nums`.

- [ ] **Step 2:** In `ChatPage`, compute `const tel = messages.filter(m => m.telemetry).map(m => m.telemetry!)` and render `<TelemetryStrip telemetry={tel} openedAt={openedAt} />` between the header and the thread, **only when the conversation has a bot** (reuse the existing bot-detection used for the model line). Track `openedAt` with a `useRef(Date.now())` reset on conversation change.

- [ ] **Step 3: Verify manually.** `npm run dev`, bot chat — totals strip appears, updates as replies arrive, font follows theme (serif in Latte, mono in Vim).
- [ ] **Step 4: Commit** — `git commit -m "feat(telemetry): session-totals strip on bot chats"`

---

## Self-Review

- Spec coverage: per-message model/latency/tokens/cost ✓ (T4), session totals ✓ (T5), capture from provider ✓ (T2), persistence ✓ (T3).
- Placeholders: none; the provider envelope unknown is handled by `parseTextGenResponse` defaulting to zeros (tested both ways).
- Type consistency: `MsgTelemetry` defined once in `shared/telemetry.ts`, consumed by server (bots.ts), schema (collections.ts), and client (strip + footer). `sumTelemetry` return shape matches the strip's reads.
- Honesty: if ugly.bot returns no usage, footers show `$0.00`/`0 tok` rather than fake numbers — consistent with brand §9 ("if we don't have the number, leave it").

## Execution Handoff

Plan complete. **(1) Subagent-Driven (recommended)** or **(2) Inline Execution**. Which approach?
