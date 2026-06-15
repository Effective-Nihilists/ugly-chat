/**
 * Config for the 3D ugly-bot call avatar.
 *
 * `BOT_AVATAR_URL` points at the GLB head the call renders via `TalkingAvatar`.
 * The model must carry ARKit-blendshape morph targets for viseme lip-sync;
 * without them `TalkingAvatar` falls back to procedural mouth motion driven by
 * the `speaking` flag (degraded but functional).
 *
 * NOTE: this is a PLACEHOLDER URL. No real GLB exists yet — the binary still
 * needs to be authored and uploaded. blob.ugly.bot has no CORS, so the asset
 * must be re-hosted in our R2 public bucket (see platform notes) and this
 * constant updated. The unit test only asserts the URL *shape* (an https `.glb`),
 * not that the asset resolves.
 */
// TODO: replace with the real ARKit-blendshape GLB hosted in our R2 public bucket
export const BOT_AVATAR_URL = 'https://blob.ugly.bot/avatars/ugly-bot.glb';

/**
 * Map a bot id to its InWorld TTS voice. All custom bots currently share one
 * default voice; per-bot voices can be added here when configurable.
 */
export function ttsVoiceForBot(_botId: string): string {
  return 'inworld-Ashley';
}
