// Message text-size preference. Drives the `--uc-msg-size` CSS variable that
// `.uc-bubble` reads, so the whole thread rescales live. Persisted to
// localStorage and applied on app boot (see main.tsx) so it takes effect before
// any conversation renders. Modeled on lib/theme.ts.
export type TextSizeId = 'small' | 'medium' | 'large' | 'xlarge';

export const TEXT_SIZES: { id: TextSizeId; label: string; px: number }[] = [
  { id: 'small', label: 'Small', px: 14 },
  { id: 'medium', label: 'Medium', px: 16 },
  { id: 'large', label: 'Large', px: 18 },
  { id: 'xlarge', label: 'X-Large', px: 20 },
];

const KEY = 'uglychat-text-size';
const DEFAULT: TextSizeId = 'medium';
const BY_ID = new Map(TEXT_SIZES.map((t) => [t.id, t]));

export function normalizeTextSize(value: string | null | undefined): TextSizeId {
  return value && BY_ID.has(value as TextSizeId) ? (value as TextSizeId) : DEFAULT;
}

export function textSizePx(id: TextSizeId): number {
  return (BY_ID.get(id) ?? BY_ID.get(DEFAULT)!).px;
}

export function loadTextSize(): TextSizeId {
  if (typeof window === 'undefined') return DEFAULT;
  return normalizeTextSize(window.localStorage.getItem(KEY));
}

export function saveTextSize(id: TextSizeId): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(KEY, id);
}

export function applyTextSize(id: TextSizeId): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--uc-msg-size', `${textSizePx(id)}px`);
  }
}
