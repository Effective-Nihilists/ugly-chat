# ugly-chat — migration TODO

Extracting all chat from **ugly.bot** into this **ugly-app**–based project, deploying to
**https://ugly.chat** on Cloudflare Workers. Full plan:
`~/.claude/plans/i-want-to-move-enchanted-starfish.md`.

**North-star goal:** run **ugly.bot and ugly.chat side-by-side** and confirm the chat UI +
functionality match (text chat, group/1:1 video, JS built-in bots). Python bots and user-created
custom bots are intentionally dropped.

## Architecture (locked)
- **Hosting:** Cloudflare Workers (studio publish flow). **Video:** Cloudflare Realtime (no Mediasoup).
- **Auth:** federated from ugly.bot (framework default; `userId`/name/avatar come from ugly.bot).
- **Media plane (STT/TTS/VAD + PSTN):** ugly.bot is the **metered proxy**; ugly.chat consumes it.
  In-call audio via a `MediaBridgeDO` + Realtime WebSocket adapter (PCM) — no Container.
- **Chat UI:** build on the **`ugly-app/conversation`** framework module (already wired by scaffold),
  not a wholesale extraction. Finish the framework `markdown/client` (ProseMirror) migration.
- **Data:** migrate chat history only (prod Postgres → Neon, userIds verbatim).

## Status legend: [ ] todo · [~] in progress · [x] done · [!] blocked

### Phase 0 — Scaffold
- [x] `npx ugly-app init ugly-chat` (projectId `11tm1kplpe`), git-committed
- [x] Create public GitHub repo `Effective-Nihilists/ugly-chat`, push (default branch `main`)
- [x] Boot locally — `ugly_chat` DB on local Postgres, `db:migrate` + `dev` on :4321; auth mode
      `uglybot` confirmed, Vite serving. ugly.bot(:3000) + ugly.chat(:4321) run side-by-side.
- [ ] **Baseline cleanup (scaffold drift, ugly-app ^0.1.126 vs installed 0.1.523):**
      `server/workers.ts` imports a non-existent `./handlers` split + omits `messages` (blocks Workers
      build); demo `InspectFixturePage.tsx` imports removed `useRouter`. Fix during Phase 3 demo strip.
      Align `ugly-app` dep to installed version.

### Phase 1 — Auth federation
- [x] Confirmed framework default (`UGLY_APP_AUTH_MODE` unset → proxy to ugly.bot `/verify`)
- [ ] "Login with ugly.bot" UX wired in client (uses framework `/auth/*` routes)
- [!] Participant **profile cache** (name/avatar for arbitrary userIds) — blocked on a ugly.bot
      public-profile endpoint (`userLoad` is self-only today)

### Phase 2 — Collections + history migration
- [x] Chat collections in `shared/collections.ts` (conversation, message, messageReaction,
      conversationUser, userConversation, userPublic); trackable realtime; migrations 002-005 applied
- [ ] Add conversationFile/conversationThread/conversationEvent if engine needs them (add when wiring deps)
- [ ] `scripts/migrate-chat-history.ts` (prod Postgres → Neon); needs prod creds + Neon target
- [ ] File-blob strategy (reference ugly.bot CDN for historical vs. copy to ugly.chat R2)

### Phase 3 — Chat layer (build on `ugly-app/conversation`)
> KEY: the full conversation+bot ENGINE is already in `ugly-app/conversation/server` (lifted from
> ugly.bot, DI via `ConversationDeps`). Phase 3/4 = implement `ConversationDeps`, not re-extract.
- [x] Real `ConversationDeps` wired into `enableConversations` (db, 5 collections, userGet w/ userPublic
      cache fallback); all optional deps are `?.`-guarded so happy path needs no extra deps
- [x] RPC ops in `shared/api.ts` + handlers in `server/index.ts`: conversationCreate/Load/MessageCreate/
      MessageReact/MessageDelete (engine fns aliased). Routes 401-gated ✓
- [x] `ChatPage` = `ChatView` + `ChatMarkdownContent`/`Input` wired to `trackDocs('message')` realtime +
      RPC ops; bootstraps a shared demo room; route `chat` (auth). Type-clean, serves 200.
- [ ] Interactive verify (login → send → realtime → react/delete) in browser; then replace demo-room
      with real conversation routing + list/search; resolve userPublic profiles for real names/avatars
- [ ] Expose remaining ops (edit, members, search, typing) + render reactions/typing in ChatView
- [!] node-canvas spike — `canvas@^3.2.1` (Image/File thumbnails) is native, no Workers support

### Framework workstream — markdown/client migration (ugly-app repo)
- [ ] Resolve Vite dep-optimization stall (prosemirror-*/codemirror/mermaid); move `markdown/client`
      into `ugly-app` so ugly.bot + ugly.chat both consume it

### Phase 4 — JS built-in bots
> Engine already has `conversationBotAdd/BotRun/BotGetAll` (in framework). Likely = provide bot defs +
> `botGet`/`serverBotCodes` deps, not re-port the runner.
- [ ] Port uglyBot/character/moderator/uglyTranslator/linguaPractice as static bot defs
- [ ] Wire bot deps (`botGet`, `serverBotCodes`, `conversationBotRun`); no custom-bot creation/BotCode sandbox

### Phase 5 — Video on Cloudflare Realtime
- [ ] Signaling Durable Object (room membership, WHIP/WHEP, fan-out)
- [ ] Rewrite client `MediasoupProvider`/`VideoCallController` onto Realtime; keep MediaStream UI
- [ ] Client-side bot "fake call" (avatar + local TTS)

### Phase 6 — Media plane (`MediaBridgeDO` + ugly.bot proxies)
- [ ] `MediaBridgeDO` (Realtime WS adapters: stream-out per track, ingest-in)
- [ ] STT (server-authoritative) → ugly.bot `/v1/audio/stt`; TTS → `/v1/audio/tts` (Inworld)
- [ ] PSTN inbound/outbound via ugly.bot `/v1/telephony` (Twilio owned + metered by ugly.bot)

### ugly.bot prerequisite track (app repo)
- [ ] `/v1/audio/{stt,tts,vad}` metered proxy (reuse SileroVAD, Deepgram/Whisper, InWorld, billing)
- [ ] `/v1/telephony` PSTN proxy (Twilio account + number pool, metering)
- [ ] `audio`/`telephony` token kinds + `type:'stt'|'tts'|'pstn'` billing; mint tokens at publish
- [ ] ugly.bot **public-profile endpoint** for arbitrary userIds (unblocks Phase 1 profile cache)

### Phase 7 — Deploy
- [ ] Studio publish → `ugly.chat` (Neon, R2, Workers-Paid, domain binding, Realtime + proxy secrets)

### Phase 8 — E2E parity harness (the north-star)
- [ ] Playwright dual-target: same federated user, identical flows vs both `BASE_URL`s
- [ ] Compare normalized app state (messages, membership, search, bot replies, video roster, transcripts)
- [ ] Document known-divergent areas (Realtime vs mediasoup connection model; recording absent)

## Open decisions
- File-blob strategy (Phase 2). Which secondary bots to carry (newsBot/podcastHost/uglyHoroscope).
