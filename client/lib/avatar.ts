/**
 * Config for the 3D ugly-bot call avatar.
 *
 * `BOT_AVATAR_URL` points at the GLB head the call renders via `TalkingAvatar`.
 * The model must carry ARKit-blendshape morph targets for viseme lip-sync;
 * without them `TalkingAvatar` falls back to procedural mouth motion driven by
 * the `speaking` flag (degraded but functional).
 *
 * The mascot GLB is re-hosted in ugly.chat's R2 public bucket and served from
 * the ugly.chat origin (`/public/avatars/...`) — same-origin, so three.js can
 * fetch it without CORS (blob.ugly.bot has none). Mirrors UGLY_BOT_GLB_URL in
 * shared/bots.ts; per-bot GLBs can override via the `glbUrl` prop.
 */
export const BOT_AVATAR_URL = 'https://ugly.chat/public/avatars/ugly-bot.glb';

/**
 * Map a bot id to its InWorld TTS voice. All custom bots currently share one
 * default voice; per-bot voices can be added here when configurable.
 */
export function ttsVoiceForBot(_botId: string): string {
  return 'inworld-Ashley';
}
