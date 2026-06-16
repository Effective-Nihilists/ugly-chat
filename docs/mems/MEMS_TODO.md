# MEMS_TODO — plan: a standalone "ugly-memorize" app

## Why this exists

"Mems" was a user-authored **Python** bot (the only heavy user of the now-removed custom-Python-bot
feature: sebrina.somers@gmail.com). It's a Bahá'í-quote **memorization coach** with real per-conversation
state, so it can't be a config-only ugly.chat bot and there is no Python runtime on Cloudflare Workers.
The original source is preserved verbatim next to this file: [`main.py`](./main.py) (+ `requirements.txt`).

Decision (2026-06-15): do **not** stand up an external Python service. Instead, rebuild Mems as a
proper standalone **ugly-app project** (`ugly-memorize`, e.g. `memorize.ugly.bot`) on Cloudflare
Workers, generalizing it beyond one user / one quote bank.

## What the original Mems does (distilled from main.py)

A spaced-repetition / comprehension coach for memorizing short texts (quotes). Per (user, conversation)
state machine with three modes:

1. **start** — `start_test()` presents the quote bank as tappable buttons (`func:"set_quote"`); the user
   picks a quote to study.
2. **comprehension** — asks literal comprehension questions whose answers re-phrase the quote's exact
   words; an LLM scores each user answer 1–10 (must use exact words for >5). After **3** answers scoring
   **≥8**, advances to memorization.
3. **memorizationFITB** — fill-in-the-blank with escalating difficulty (more words blanked each round);
   an LLM scores recall 1–10; at **≥9** the quote is considered memorized and returns to `start`.

Key primitives the original relied on (from the old `ugly_bot` Python SDK):
- per-conversation persisted state: `data_get()` / `data_set(...)` (mode, current quote/attribution,
  `comprehension_start`, `comprehension_correct_count`, `comprehension_last_time`, `memorization_start`).
- `message_history(start=…)`, `messages_to_text(...)`, `MessageVisibility`, `MessageColor`.
- `text_gen(model=…, instruction=…, messages|question=…, max_tokens=…)` — scoring + question generation.
- `message_send(text|markdown=…, buttons=[…], visibility=…, color=…)`, `file_create(...)`,
  `conversation_content_show(...)` (pins the quote as a file in the conversation).
- handler exports: `conversation_start` (init), `message_direct` (per user message), `set_quote` (button).

### Known bugs noted in the original (carry forward as requirements/tests)
- It must **start every new quote in comprehension mode** (it sometimes jumped straight to FITB after
  generating a new quote).
- After a quote is learned it should **resume at the last-memorized quote**, not restart at the first.

## Target app shape (ugly-memorize)

A fresh `ugly-app init` project deployed to Workers (mirror the ugly.chat/ugly-fortune patterns).

- **Collections**
  - `quoteSet` — `{ ownerId, title, public, items: [{ title, quote, attribution }] }` (generalize the
    hard-coded `quotes` array; let users/admins create banks; seed with sebrina's Bahá'í bank from `main.py`).
  - `memorizeProgress` — `{ userId, quoteSetId, quoteIndex, mode: 'start'|'comprehension'|'fitb'|'done',
    comprehensionCorrect, lastScoredAt, startedAt, memorizedQuoteIndexes: number[] }` (replaces the old
    per-conversation `data_*`; key by (userId, quoteSetId) so progress survives and resumes correctly).
- **Server endpoints** (`shared/api.ts` + handlers): `quoteSetList/Create`, `sessionStart`
  (pick/resume quote), `answer` (the `message_direct` equivalent — runs the mode state machine, scores
  via `textGen`, advances), `pickQuote`.
- **Scoring/questions** via the framework `textGen` (see ugly.chat's #2 approach — `/v1/ai/text` /
  framework `textGenCreate`); pick a strong available model (gpt_4o works today; deepseek as fallback).
- **State machine** ported from `main.py` with the two bug-fixes above baked in + unit tests:
  - new quote → always `comprehension`; 3×(≥8) → `fitb`; `fitb` ≥9 → mark index memorized, advance to the
    next *un-memorized* index (resume logic), not index 0.
- **UI** — a focused study screen (current quote card, chat-style Q&A, progress: comprehension x/3,
  FITB difficulty, quotes memorized N/total). Reuse the framework conversation UI if convenient, but the
  state lives in `memorizeProgress`, not in chat messages.
- **Spaced repetition (phase 2)** — schedule review of memorized quotes over time (the original cited an
  SRS algorithm). Add a `nextReviewAt` per memorized item + a daily cron to surface due reviews.

## Migration / onboarding for sebrina
- Seed a public `quoteSet` "Bahá'í Writings" from the `quotes` array in `main.py`.
- Her account is `ph2fotkUZ1e4y_btuu430` (post identity-repoint). No old Mems state is portable
  (it lived in the Python bot's per-conversation store); she restarts cleanly.

## Status
- [x] Original source preserved (`main.py`, `requirements.txt`).
- [ ] `ugly-app init ugly-memorize` + collections + endpoints + state machine (+ tests for the 2 bugs).
- [ ] Seed Bahá'í quote bank.
- [ ] Deploy to memorize.ugly.bot; smoke-test the comprehension→FITB→memorized→resume flow.
