/**
 * Shared brand tokens for the public landing page.
 *
 * Copied from ugly-bot/client/landing/ — keep in sync by hand; the two repos
 * share no package.
 *
 * Mirrors the YouTube show's brand palette so the product pages and the show
 * feel like the same artifact. Uses the ugly-app CSS variable bridge for theme
 * portability (dark/light) where neutral tokens are concerned; the brand orange
 * stays constant in both themes.
 */

export const BRAND = '#FF5500';
export const BRAND_GRAD =
  'linear-gradient(135deg, #FF8041 0%, #FF5500 50%, #E63900 100%)';
export const BRAND_GLOW = 'rgba(255,85,0,0.14)';
export const BRAND_GLOW_STRONG = 'rgba(255,85,0,0.3)';

export const BG = 'var(--app-background)';
// `--app-secondary` / `--app-border` aren't reliably defined by the framework
// (they render transparent → invisible cards), so derive elevated surfaces +
// borders from the foreground/background that ARE defined. Works in light+dark.
export const BG_ELEV =
  'color-mix(in srgb, var(--app-foreground) 6%, var(--app-background))';
// Subtle borders — a low foreground mix so they don't read as bright/white lines
// in dark mode (the earlier 16%/30% looked like white borders on the dark home page).
export const BORDER =
  'color-mix(in srgb, var(--app-foreground) 9%, var(--app-background))';
export const BORDER_STRONG =
  'color-mix(in srgb, var(--app-foreground) 17%, var(--app-background))';
export const TEXT = 'var(--app-foreground)';
export const TEXT_MUTED =
  'color-mix(in srgb, var(--app-foreground) 62%, transparent)';
export const TEXT_FAINT =
  'color-mix(in srgb, var(--app-foreground) 38%, transparent)';
export const ON_BRAND = '#ffffff';

export const OK = '#4ade80';
export const WARN = '#fbbf24';
export const ERR = '#f87171';

export const FONT_DISPLAY =
  "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif";
export const FONT_MONO =
  "'JetBrains Mono', 'SF Mono', 'Fira Code', ui-monospace, monospace";
export const FONT_BODY =
  "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
