/**
 * Helpers for handing off to ugly.bot, the identity provider.
 *
 * User profile (name/avatar/etc.) is owned by ugly.bot in Mode A, so ugly.chat
 * doesn't maintain its own profile editor — the "User settings" button opens
 * ugly.bot's real settings page (where the change is canonical and federates
 * back to every ugly.bot app).
 */
function uglyBotUrl(): string {
  return (window as unknown as Record<string, string>).__UGLY_BOT_URL__ ?? 'https://ugly.bot';
}

/** Open ugly.bot's user settings in a new tab. */
export function openUglyBotSettings(): void {
  window.open(`${uglyBotUrl()}/settings`, '_blank', 'noopener');
}
