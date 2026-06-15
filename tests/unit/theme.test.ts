import { describe, it, expect, beforeEach, vi } from 'vitest';
import { THEMES, normalizeTheme, applyThemeAttr } from '../../client/lib/theme';

describe('theme', () => {
  it('lists the five themes with auto first', () => {
    expect(THEMES.map((t) => t.id)).toEqual(['auto', 'light', 'dark', 'cosmic-latte', 'vim']);
  });
  it('normalizes unknown values to auto', () => {
    expect(normalizeTheme('nope')).toBe('auto');
    expect(normalizeTheme('vim')).toBe('vim');
    expect(normalizeTheme(null)).toBe('auto');
  });
  it('removes the data-theme attribute for auto, sets it otherwise', () => {
    const el = { dataset: {} as Record<string, string>, removeAttribute: vi.fn(() => { delete (el.dataset as Record<string,string>).theme; }) } as unknown as HTMLElement;
    applyThemeAttr(el, 'vim');
    expect(el.dataset.theme).toBe('vim');
    applyThemeAttr(el, 'auto');
    expect(el.removeAttribute).toHaveBeenCalledWith('data-theme');
  });
});
