// The canonical "Ugly Bot" — a real ugly.bot account userId that the chat
// migration carried over. It's a plain userId (not a `bot-` id), so it's
// special-cased as a known bot: its DMs reply + show the bot UI, and every user
// gets a conversation with it. Shared between client (auto-create the DM) and
// server (recognize it + generate replies).
export const UGLY_BOT_USER_ID = 'jY0oTxnxd3Ff5AQn6qpFJ';

// Canonical profile, mirrored from ugly.bot's hardcoded mascot avatar
// (app/shared/MascotAvatar.ts). ugly.bot serves the bot's avatar from this
// constant, NOT a normal userPublic row, so the migrated userPublicBatch lookup
// returns nothing for it — hence we pin name + avatar + background here.
export const UGLY_BOT_AVATAR_URL =
  'https://blob.ugly.bot/user/jY0oTxnxd3Ff5AQn6qpFJ/K4iCNInoEjgMMmhY_XVFB.webp';
export const UGLY_BOT_BACKGROUND_URL =
  'https://blob.ugly.bot/user/jY0oTxnxd3Ff5AQn6qpFJ/3JQdhJcBXmvDfrlDC8kPI';

export const UGLY_BOT = {
  id: UGLY_BOT_USER_ID,
  name: 'Ugly Bot',
  model: 'deepseek_v4_flash',
  avatarUrl: UGLY_BOT_AVATAR_URL,
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
