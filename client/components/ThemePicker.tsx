import React, { useState } from 'react';
import { THEMES, loadTheme, saveTheme, applyTheme, type ThemeId } from '../lib/theme';

export function ThemePicker(): React.ReactElement {
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const pick = (id: ThemeId): void => { setTheme(id); saveTheme(id); applyTheme(id); };
  return (
    <div style={{ display: 'flex', gap: 2, padding: '8px 10px', borderTop: '1px solid var(--app-border)', flexWrap: 'wrap' }}>
      {THEMES.map((t) => {
        const on = t.id === theme;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => pick(t.id)}
            style={{
              fontFamily: 'var(--app-font-mono, monospace)', fontSize: 10, letterSpacing: '0.04em',
              padding: '5px 8px', border: `1px solid ${on ? 'var(--app-primary)' : 'transparent'}`,
              color: on ? 'var(--app-primary)' : 'var(--app-foreground-60)',
              background: on ? 'var(--app-primary-20)' : 'transparent', cursor: 'pointer',
            }}
          >
            {t.label.toLowerCase()}
          </button>
        );
      })}
    </div>
  );
}
