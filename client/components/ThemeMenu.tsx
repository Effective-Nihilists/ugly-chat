import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { THEMES, loadTheme, saveTheme, applyTheme, type ThemeId } from '../lib/theme';

// Popups render OUTSIDE <AppProvider>; this one needs no app deps (theme lives
// in localStorage), only the close handle passed by the opener.
interface PopupOpener {
  openPopup: (
    content: React.ReactNode,
    opts?: { mode?: 'block' | 'transient' | 'contextMenu' },
  ) => { hide: () => void };
}

/** Open the small theme context-menu popup. */
export function openThemeMenu(router: PopupOpener): void {
  const handle = router.openPopup(<ThemeMenu onClose={() => { handle.hide(); }} />, { mode: 'transient' });
}

/**
 * Small square brand-styled context menu listing the five themes. The current
 * one is highlighted + check-marked; clicking applies + persists immediately.
 */
export function ThemeMenu({ onClose }: { onClose: () => void }): React.ReactElement {
  const [theme, setTheme] = useState<ThemeId>(() => loadTheme());
  const pick = (id: ThemeId): void => {
    setTheme(id);
    saveTheme(id);
    applyTheme(id);
    onClose();
  };
  return (
    <div style={menu}>
      <div style={menuLabel}>
        <span style={{ color: 'var(--app-primary)' }}>{'//'}</span> theme
      </div>
      {THEMES.map((t) => {
        const on = t.id === theme;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => { pick(t.id); }}
            className="uc-row"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '9px 12px',
              border: 'none',
              background: on ? 'rgba(var(--app-primary-rgb), 0.10)' : 'transparent',
              color: on ? 'var(--app-primary)' : 'var(--app-foreground)',
              fontSize: 14,
              fontWeight: on ? 700 : 500,
              cursor: 'pointer',
              textAlign: 'left',
              font: 'inherit',
            }} data-id="label"
          >
            <span style={{ width: 16, display: 'inline-flex', flexShrink: 0 }}>
              {on ? <Check size={16} /> : null}
            </span>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

const menu: React.CSSProperties = {
  width: 200,
  background: 'var(--app-main)',
  border: '1px solid var(--app-border)',
  borderRadius: 12,
  padding: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  overflow: 'hidden',
};
const menuLabel: React.CSSProperties = {
  fontFamily: 'var(--app-font-mono)',
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: 'var(--app-foreground-muted)',
  padding: '6px 12px 4px',
};
