export type ThemeId = "auto" | "light" | "dark" | "cosmic-latte" | "vim";

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "cosmic-latte", label: "Latte" },
  { id: "vim", label: "Vim" },
];

const KEY = "uglychat-theme";
const IDS = new Set(THEMES.map((t) => t.id));

export function normalizeTheme(value: string | null | undefined): ThemeId {
  return value && IDS.has(value as ThemeId) ? (value as ThemeId) : "auto";
}

export function loadTheme(): ThemeId {
  if (typeof window === "undefined") return "auto";
  return normalizeTheme(window.localStorage.getItem(KEY));
}

export function saveTheme(theme: ThemeId): void {
  if (typeof window !== "undefined") window.localStorage.setItem(KEY, theme);
}

export function applyThemeAttr(el: HTMLElement, theme: ThemeId): void {
  if (theme === "auto") el.removeAttribute("data-theme");
  else el.dataset.theme = theme;
}

export function applyTheme(theme: ThemeId): void {
  if (typeof document === "undefined") return;
  applyThemeAttr(document.documentElement, theme);
  syncColorScheme();
}

/** Themes whose palette is dark. Everything else (light, cosmic-latte) is light. */
const DARK_THEMES = new Set<string>(["dark", "vim"]);

/**
 * The scheme a theme attribute actually renders in. `attr` is the live
 * `data-theme` value (undefined = auto, which follows the system).
 */
export function resolveScheme(
  attr: string | undefined,
  systemDark: boolean,
): "light" | "dark" {
  if (!attr || !IDS.has(attr as ThemeId) || attr === "auto")
    return systemDark ? "dark" : "light";
  return DARK_THEMES.has(attr) ? "dark" : "light";
}

/**
 * The `color-scheme` value for a resolved scheme.
 *
 * `only light`, not `light`: the `only` keyword is what tells a WebView's
 * algorithmic darkening (Android "force dark", Chrome Auto Dark Mode) that the
 * page is not to be recoloured. Without it a light page inside a dark-mode
 * Android WebView can be painted dark behind the app's back. A dark page
 * declares `dark`, which already opts out.
 */
export function colorSchemeValue(scheme: "light" | "dark"): string {
  return scheme === "dark" ? "dark" : "only light";
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/**
 * Bring `color-scheme` (inline on <html> and the meta tag) in line with the
 * theme that is actually showing. Call after anything changes `data-theme`;
 * the system-theme listener calls it when the OS flips.
 */
export function syncColorScheme(): void {
  if (typeof document === "undefined") return;
  try {
    const root = document.documentElement;
    const value = colorSchemeValue(
      resolveScheme(root.dataset.theme, systemPrefersDark()),
    );
    root.style.setProperty("color-scheme", value);
    let meta = document.querySelector<HTMLMetaElement>(
      'meta[name="color-scheme"]',
    );
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "color-scheme";
      document.head.appendChild(meta);
    }
    meta.content = value;
  } catch {
    // A partial DOM (tests, a detached preview): the stylesheet's own
    // color-scheme rules still apply.
  }
}

let systemListenerInstalled = false;

/**
 * Follow the OS theme live while the theme is "auto". The palette itself
 * follows through the stylesheet's `prefers-color-scheme` block; this keeps
 * `color-scheme` (form controls, scrollbars, force-dark opt-out) with it.
 */
export function installSystemThemeListener(): void {
  if (systemListenerInstalled || typeof window === "undefined") return;
  systemListenerInstalled = true;
  try {
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", syncColorScheme);
  } catch {
    // No matchMedia (very old WebView): the theme simply stays as applied.
  }
  syncColorScheme();
}
