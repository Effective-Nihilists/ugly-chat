/**
 * Helpers for handing off to ugly.bot, the identity provider.
 *
 * User profile (name/avatar/etc.) is owned by ugly.bot in Mode A, so ugly.chat
 * doesn't maintain its own profile editor — the "User settings" button opens
 * ugly.bot's real settings page (where the change is canonical and federates
 * back to every ugly.bot app).
 */
function uglyBotUrl(): string {
  return (
    (window as unknown as Record<string, string>).__UGLY_BOT_URL__ ??
    "https://ugly.bot"
  );
}

/** Open ugly.bot's user settings in a new tab. */
export function openUglyBotSettings(): void {
  window.open(`${uglyBotUrl()}/settings`, "_blank", "noopener");
}

/**
 * Open ugly.bot's character creator in a new tab, deep-linked back here:
 * after the character is saved, ugly.bot redirects the tab to `returnUrl`
 * with `?characterId=…&thumb=…` appended (the bot editor absorbs those into
 * its form state). With `characterId` set it edits that character, otherwise
 * it starts a new one.
 */
export function openUglyBotCharacterCreator(
  returnUrl: string,
  characterId?: string | null,
): void {
  const page = characterId ? `characters/${characterId}` : "characters/new";
  window.open(
    `${uglyBotUrl()}/${page}?return=${encodeURIComponent(returnUrl)}&for=ugly-chat`,
    "_blank",
    "noopener",
  );
}
