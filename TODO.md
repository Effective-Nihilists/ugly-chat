# ugly-chat — migration TODO

Extracting all chat from **ugly.bot** into this **ugly-app**–based project, deployed to
**https://ugly.chat** on Cloudflare Workers. Full plan:
`~/.claude/plans/i-want-to-move-enchanted-starfish.md`.

**North-star goal:** run **ugly.bot and ugly.chat side-by-side** with matching chat UI +
functionality (text chat, group/1:1 video, JS built-in bots). Python bots and user-created
custom-code bots are intentionally dropped.

## Current status (2026-06-14)
**LIVE on https://ugly.chat (Cloudflare Workers).** Text chat is effectively at parity; the large
remaining work is voice/video. Key facts:
- **App shell:** sidebar (wordmark, search, create, live `conversationListMine`), chat-home
  directory (Featured cards), thread view (themed bubbles, markdown, reactions, full-width date
  separator, scroll-to-bottom).
- **History MIGRATED (prod → Neon)** via `scripts/migrate-chat-history.cjs` (idempotent keyset
  upsert; userIds verbatim). ~88k conversations · 547k messages.
- **Engine reality:** the full conversation+bot engine ships in `ugly-app/conversation/server`
  (`engine.js`) — already exports `conversationMessageEdit`, `conversationMessageSearch`,
  `conversationSearch`, `conversationSetTyping`, `conversationUserAdd/Remove/UpdateRole`,
  `conversationDelete/DeleteAll`, etc. So most remaining **text** work is *wiring existing engine
  fns into `shared/api.ts` + `server/handlers.ts` + client UI*, not re-porting logic.

**Voice (TTS/STT) already exists** — ugly.bot (the live repo is `../ugly-bot`, NOT the dead
`../app`) serves TTS (`server/tts.ts`, InWorld) + STT (`server/stt.ts`, Whisper) over the app
WebSocket; the framework exposes `useTTS`/`useSTT(uglyBotSocket)` and `useApp()` already provides a
connected `uglyBotSocket`. So there's NO `/v1/audio` proxy to build — the remaining voice work is
just consuming it in the chat UI. (Per-call audio billing was added in `../ugly-bot` 2026-06-14.)
**Biggest remaining chunk = group/1:1 VIDEO** (Cloudflare Realtime signaling DO, Phase 5).

## Architecture (locked)
- **Hosting:** Cloudflare Workers. **Video:** Cloudflare Realtime (no Mediasoup).
- **Auth:** federated from ugly.bot (`userId`/name/avatar come from ugly.bot; `userPublic` cache).
- **Media plane (STT/TTS/VAD + PSTN):** ugly.bot is the **metered proxy**; ugly.chat consumes it
  via a `MediaBridgeDO` + Realtime WebSocket adapter (PCM) — no Container.
- **Chat UI:** build on the **`ugly-app/conversation`** framework module; consume the framework
  `markdown/client` (ProseMirror) via `client/components/ConversationInput.tsx`.
- **No hidden conversations** — both creation paths force `hidden: false` (a hidden conversation
  never appears in `conversationListMine`, stranding the user). Engagement (`conversationLoad` /
  `conversationMessageCreate`) un-hides any legacy hidden rows for human members.

## Status legend: [ ] todo · [~] in progress · [x] done · [!] blocked

### Phase 0–2 — Scaffold · Auth federation · Collections + history — DONE
- [x] Scaffold (projectId `11tm1kplpe`), GitHub repo, local + prod boot
- [x] Federated auth (`UGLY_APP_AUTH_MODE=uglybot`); login UX; `userPublic` profile cache
      (`resolveProfiles` → ugly.bot `userPublicBatch`, 24h TTL)
- [x] Collections: conversation, message, messageReaction, conversationUser, userConversation,
      userPublic, bot, collabDoc, todo
- [x] History migration script (prod Postgres → Neon)
- [ ] **conversationFile collection** + file-blob strategy (needed for attachments metadata/thumbs)

### Phase 3 — Chat layer — MOSTLY DONE
- [x] `ConversationDeps` wired into `enableConversations`; engine ops live
- [x] Core RPC: conversationCreate / Load / MessageCreate / MessageReact / MessageDelete
- [x] `ChatPage` (real conversation routing, list, live `trackDocs`, reactions, real profiles)
- [x] Markdown composer — `ConversationInput` (ProseMirror slash menu, formatting, mentions, image paste)
- [x] Link previews (OpenGraph unfurl on message create — `server/linkPreview.ts`)
- [x] **Message edit** — `conversationMessageEdit` wired (api + handler + inline edit UI)
- [x] **Search** — Postgres FTS (`006` migration: `search` tsvector + trigger + backfill) →
      `db.searchDocs`; api + handler + global SearchPage + chat-home affordance
- [x] **Typing indicators** — `conversationSetTyping` wired (api + handler); composer emits
      throttled start/stop, ChatView renders via `typingEntries`/`onTypingStart`
- [x] **Group membership admin** — `conversationMembers/MemberAdd/MemberRemove/MemberRole` wired;
      ⋯ → Members popup: list, owner remove + role toggle, leave, **add members** (picker sourced
      from `userContacts` = people you share conversations with, so no global directory needed).
- [x] **System messages (membership)** — `memberAdd`/`memberRemove`/`memberLeave` posted as
      `'global'` from the member handlers + rendered as centered system lines (resolve `systemParam`
      → name). STILL TODO: call join/leave system events.
- [x] **Conversation delete** — owner-only `conversationDelete` (cascade via typed DB →
      message/messageReaction/conversationUser/userConversation); ⋯ → Members popup, two-step
      confirm. Distinct from message-wipe `conversationClear`.
- [!] **node-canvas image pipeline** — `canvas@^3.2.1` (thumbnails/compositing) is native, no
      Workers support. Needs Cloudflare Images / client-side canvas / offloaded resize.

### Phase 4 — JS built-in + config bots — DONE
- [x] Built-in bots (`bot-ugly`, `bot-sage`), config-only custom bots (`bot` collection)
- [x] Canonical Ugly Bot (`jY0…`) — pinned profile (name/avatar/background), replies, ⋯ menu,
      auto-DM for every user
- [x] Cross-app / webhook bots (`server/appApi.ts`, `server/webhooks.ts`)
- [ ] Port remaining personas if wanted (character/moderator/uglyTranslator/linguaPractice)

### Phase 5 — Video on Cloudflare Realtime — DONE ✅ (verified 2-browser e2e, 8/8)
- [x] Call lifecycle + roster on `conversation.call` (`server/video.ts`); dot-path writes (no
      read-modify-write clobber race between concurrent joiners)
- [x] **Credentials automation** — `realtime.*`/`calls.*` OAuth scopes (framework
      `CLOUDFLARE_SCOPES`); publish provisions an SFU app + TURN key (`provisionRealtime`) and
      injects `REALTIME_APP_ID/SECRET` + `REALTIME_TURN_KEY_ID/TOKEN` as worker secrets
- [x] **No signaling DO** — the SFU/TURN REST calls are brokered in `server/realtime.ts` RPCs (app
      secret stays server-side); peer/track discovery uses the existing `conversation.call` roster
- [x] **Client on Realtime** (`VideoCall.tsx`) — push local tracks, pull peers (batched, serialized
      on one negotiation chain), render. Robustness: poll the **fresh server roster**
      (`conversationVideoState` — client `getDoc` only returns the stale trackDoc cache) + retry
      pulls on any failure (self-healing)
- [x] **E2E** (`scripts/e2e-video.mjs`) — two headless chromium contexts w/ fake media, federated
      JWT auth (ugly.bot secret), asserts each peer decodes the other's 640×480 audio+video. 8/8.
- [ ] Bot "fake call" voice (avatar + TTS) — tiles render; voice not wired
- [x] Framework **released** as `ugly-app@0.1.577` (realtime scopes + provisioning); ugly.chat
      pinned to it via pnpm (`pnpm-lock.yaml`). NB: ugly.chat uses **pnpm**, not npm — `npm install`
      corrupts its `.pnpm` node_modules. 0.1.577 also carried a pre-committed keyboard refactor
      (removed `useKeyboardHeight`/`useIsKeyboardOpen` → use `useSafeAreaInsets().keyboard`);
      adapted `SafeAreaTestPage`. Other child apps using those hooks need the same one-liner.

### Phase 6 — Voice in the chat UI (TTS/STT already exist over the WS) — IN PROGRESS
> CORRECTION: the planned `/v1/audio` REST proxy + `MediaBridgeDO` were NOT needed for basic
> voice. ugly.bot already streams TTS/STT over the app WebSocket; `useApp().uglyBotSocket` +
> framework `useTTS`/`useSTT` consume it. `AudioTestPage` proves it works end-to-end.
- [x] **TTS playback** — speaker button on bot/other messages → `useTTS(uglyBotSocket).play(text)`
      via a shared `VoiceProvider` (one TTS instance for all bubbles)
- [x] **STT dictation** — mic button in `ConversationInput` (`DictationButton` → `useSTT`),
      transcript appended to the composer (batch/push-to-talk)
- [ ] In-CALL server-authoritative STT/TTS + PSTN (the `MediaBridgeDO` + `/v1/telephony` work) is a
      VIDEO-call concern — defer with Phase 5; not needed for 1:1 TTS/STT.

### ugly.bot audio billing — DONE (in `../ugly-bot`, uncommitted/not deployed)
- [x] Per-call gate (`canUserSpend`) + credit draw-down wired into `tts.ts`/`stt.ts` (2026-06-14).
      NB: AI still doesn't meter spend (billing-phase3 ledger pending) — owner will reconcile.

### Phase 7 — Deploy — DONE (text); revisit for media secrets
- [x] Studio/CLI publish → `ugly.chat` (Neon, R2, Workers-Paid, domain binding, `/_init`)
- [ ] Add Realtime API + audio/telephony proxy secrets when Phases 5–6 land

### Phase 8 — E2E parity harness (north-star) — NOT STARTED
- [ ] Playwright dual-target: same federated user, identical flows vs both `BASE_URL`s
- [ ] Compare normalized app state (messages, membership, search, bot replies, video roster)

## Smaller text-chat gaps (low priority)
- [x] **Conversation pinning** — `conversationSetPinned` (userConversation visibility
      `pinned`↔`visible`); sidebar `ConversationRow` hover pin toggle; list already sorts pinned-first.
      (TODO: also surface the toggle in ChatHomePage's `HomeRow`.)
- [x] **Message pinning** — `conversationPinMessage` (one pinned message per conversation on
      `conversation.pinnedMessageId`); pin toggle in the message hover bar + a pinned banner above
      the thread (fetches the message by id so it works outside the loaded window) + unpin.
- [x] **Unread badges + last-message previews** — the engine never maintained `userConversation`'s
      `notificationCount`/`notificationText` (so the sidebar showed 0 unread + empty preview).
      Added `server/listDenorm.ts`: `bumpListForMessage` (on human + bot messages → preview + unread
      for recipients, sender marked read, recency bump, un-hide) + `markRead` (on open / while
      viewing, via `conversationMarkRead`).
- [ ] Read receipts ("seen by" per message), audio messages, message anchors / file comments,
      push-on-new-message wired to chat events, ChatHomePage pin toggle

## Open decisions
- File-blob strategy (reference ugly.bot CDN for historical vs. copy to ugly.chat R2).
- Which secondary bots to carry (newsBot/podcastHost/uglyHoroscope depend on scrapers).
