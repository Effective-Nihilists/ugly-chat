// The canonical "Ugly Bot". Migrated (2026-06) from the legacy plain ugly.bot
// userId (`jY0oTxnxd3Ff5AQn6qpFJ`, stored as a `userPublic` isBot row) to a
// proper `bot` collection row with the `bot-` id below — so it resolves through
// the same path as every other bot and carries a 3D avatar + 2D image +
// background. Shared between client (auto-create the DM, id format
// `bot-ugly+<userId>`) and server (recognize it + generate replies).
export const UGLY_BOT_ID = 'bot-ugly';

// The mascot avatar, re-hosted in ugly.chat's R2 public bucket and served from
// the ugly.chat origin (blob.ugly.bot has no CORS; same-origin avoids it). The
// GLB drives the 3D TalkingAvatar; the webp is the 2D list/header/thread image;
// the background is the conversation backdrop. These seed the `bot-ugly` row.
//
// 2D image: the original mascot webp on blob.ugly.bot 404s (only the GLB exists),
// so the 2D avatar is the "ugly" brand mark re-hosted in our R2 public bucket.
export const UGLY_BOT_GLB_URL = 'https://ugly.chat/public/avatars/ugly-bot.glb';
export const UGLY_BOT_AVATAR_URL = 'https://ugly.chat/public/avatars/ugly-bot.webp';
export const UGLY_BOT_BACKGROUND_URL =
  'https://blob.ugly.bot/user/jY0oTxnxd3Ff5AQn6qpFJ/3JQdhJcBXmvDfrlDC8kPI';

export const UGLY_BOT = {
  id: UGLY_BOT_ID,
  name: 'Ugly Bot',
  model: 'deepseek_v4_flash',
  avatarUrl: UGLY_BOT_AVATAR_URL,
  avatarGlbUrl: UGLY_BOT_GLB_URL,
  backgroundUrl: UGLY_BOT_BACKGROUND_URL,
  systemPrompt:
    "You are Ugly Bot — a witty, sarcastic chatbot with no chill and an endless " +
    'supply of snark. You playfully roast the user about whatever they bring up ' +
    "(their style, choices, questions) — it's all in good fun, never genuinely " +
    'mean or hateful. You are still genuinely helpful underneath the sass. Keep ' +
    'replies short and punchy.',
  firstMessage:
    "Well, look who showed up. I'm Ugly Bot — ask me anything and I'll help… " +
    'right after I roast you a little. What do you need?',
} as const;
