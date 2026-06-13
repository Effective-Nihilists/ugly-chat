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
- [ ] Create public GitHub repo `Effective-Nihilists/ugly-chat`, push

### Phase 1 — Auth federation
- [x] Confirmed framework default (`UGLY_APP_AUTH_MODE` unset → proxy to ugly.bot `/verify`)
- [ ] "Login with ugly.bot" UX wired in client (uses framework `/auth/*` routes)
- [!] Participant **profile cache** (name/avatar for arbitrary userIds) — blocked on a ugly.bot
      public-profile endpoint (`userLoad` is self-only today)

### Phase 2 — Collections + history migration
- [ ] Port chat collections into `shared/collections.ts` (conversation, conversationUser,
      userConversation, message, messageReaction, conversationFile, conversationThread, conversationEvent)
- [ ] `scripts/migrate-chat-history.ts` (prod Postgres → Neon); needs prod creds + Neon target
- [ ] File-blob strategy (reference ugly.bot CDN for historical vs. copy to ugly.chat R2)

### Phase 3 — Chat layer (build on `ugly-app/conversation`)
- [ ] Extend framework `enableConversations` server for gaps (threads, search, files, roles, system msgs)
- [ ] Register chat ops in `shared/api.ts` + `server/index.ts`; live delivery via `trackDocs`
- [ ] Remove bot-create/code routes; wire conversation pages in `client/allPages.ts`
- [!] node-canvas spike — `canvas@^3.2.1` (Image/File thumbnails) is native, no Workers support

### Framework workstream — markdown/client migration (ugly-app repo)
- [ ] Resolve Vite dep-optimization stall (prosemirror-*/codemirror/mermaid); move `markdown/client`
      into `ugly-app` so ugly.bot + ugly.chat both consume it

### Phase 4 — JS built-in bots
- [ ] Port uglyBot/character/moderator/uglyTranslator/linguaPractice + slimmed `wrapper.ts`
- [ ] Sever all `BotCode.ts` imports; static bot registry (no custom-bot creation)

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
