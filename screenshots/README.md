# Screenshot verification harness

Captures every core screen of the **deployed** app (https://ugly.chat) next to
its design mock (`mockups/*.html`) so we can see where the implementation
diverges. This is **read-only verification tooling** — it never modifies app
source.

## What it produces

- `screenshots/mock/<key>-{desktop,mobile}.png` — the `.desktop` / `.phone`
  frames of each `mockups/*.html`.
- `screenshots/actual/<key>-{desktop,mobile}.png` — the live deployed screen.
- `screenshots/compare.html` — side-by-side mock vs actual, with a PASS/FAIL
  header. Open it in a browser.

(All PNGs + `compare.html` are git-ignored; only the scripts are committed.)

## Screens (keys)

| key | route | mock |
| --- | --- | --- |
| `list` | `/chat` | conversation-list.html |
| `chat-bot` | `/chat/<UGLY_BOT>+<user>` | chat.html |
| `chat-human` | `/chat/dm-<user>+<partner>` | chat-human.html |
| `new-chat` | `/new` | new-chat.html |
| `new-group` | `/new-group` | new-group.html |
| `settings-group` | `/settings/grp-screenshot-demo` | chat-settings.html |
| `settings` | `/settings` | (no matching mock element) |
| `call-bot` | `/chat/<bot dm>` → start call | call-bot.html |
| `call-2p` | `/chat/<human dm>` → start call | call-2p.html |

Calls are **best effort** (fake media devices); a true 2-person call needs two
live peers, so `call-2p` may only show one side or fail — capture it manually if
needed.

## Auth / data

The synthetic screenshot user is **Alex Rivera**
(`5c0e5c0e-0000-4000-8000-5c0e5c0e5c0e`), partner **Sam Rivera**
(`...5c0e5c0e5c0f`). Both must exist in ugly.bot's Postgres. Sessions are HS256
JWTs minted with ugly.bot's `AUTH_SECRET` (resolved from the sibling
`../ugly-bot` repo's `publish-state.json`), set as the `auth_token` cookie —
ugly.chat is a Mode A child app and verifies sessions via ugly.bot `/verify`.

## Run order

```bash
# 1. (once) create the screenshot users in ugly.bot if they don't exist
cd ../ugly-bot && SCREENSHOT_USER_ID=5c0e5c0e-0000-4000-8000-5c0e5c0e5c0e \
  SCREENSHOT_PARTNER_USER_ID=5c0e5c0e-0000-4000-8000-5c0e5c0e5c0f \
  npx tsx scripts/create-screenshot-user.ts && cd ../ugly-chat

# 2. seed the three conversations against ugly.chat (idempotent)
npx tsx scripts/seed-screenshots.ts

# 3. shoot the mocks (no network/auth)
npx tsx scripts/screenshots/capture-mocks.ts

# 4. shoot the live screens
npx tsx scripts/screenshots/capture.ts

# 5. build the side-by-side report
npx tsx scripts/screenshots/build-compare.ts
# open screenshots/compare.html
```
