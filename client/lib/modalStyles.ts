import type React from 'react';

// Shared modal / form styling (ported from brand.css → app tokens). Originally
// lived in NewChatPage; extracted here when new-chat became a popup so other
// modal-style pages (ChatSettingsPage) can keep reusing it.
const page: React.CSSProperties = {
  height: '100%',
  overflowY: 'auto',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  background: 'var(--app-main)',
  padding: '24px 16px',
};
const modal: React.CSSProperties = {
  width: 'min(440px, 100%)',
  background: 'var(--app-main)',
  border: '1px solid var(--app-border)',
  display: 'flex',
  flexDirection: 'column',
};
const modalHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px 14px',
  borderBottom: '1px solid var(--app-border)',
};
const modalTitle: React.CSSProperties = {
  fontFamily: 'var(--app-font-heading)',
  fontWeight: 800,
  fontSize: 16,
  color: 'var(--app-foreground)',
};
const closeBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  border: 'none',
  background: 'transparent',
  color: 'var(--app-foreground)',
  cursor: 'pointer',
};
const modalBody: React.CSSProperties = {
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};
const field: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };
const fieldLabel: React.CSSProperties = {
  fontFamily: 'var(--app-font-mono)',
  fontSize: 10.5,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: 'var(--app-foreground-muted)',
};
const inputRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 12px',
  height: 44,
  border: '1px solid var(--app-border)',
  background: 'var(--app-tertiary)',
};
const inputEl: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: 'none',
  background: 'transparent',
  outline: 'none',
  fontSize: 15,
  color: 'var(--app-foreground)',
};
const hint: React.CSSProperties = { fontSize: 12.5, lineHeight: 1.45, color: 'var(--app-foreground)', opacity: 0.55 };
const memberRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  padding: '8px 6px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  font: 'inherit',
};
const memberName: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--app-foreground)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const memberSub: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--app-foreground)',
  opacity: 0.5,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
const modalFoot: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '12px 14px',
  borderTop: '1px solid var(--app-border)',
};
const ghostBtn: React.CSSProperties = {
  padding: '9px 16px',
  border: '1px solid var(--app-border)',
  background: 'var(--app-main)',
  color: 'var(--app-foreground)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};
const ctaBtn = (disabled: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '9px 18px',
  border: 'none',
  background: 'var(--app-primary)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 700,
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1,
});

export const modalStyles = {
  page, modal, modalHead, modalTitle, closeBtn, modalBody, field, fieldLabel,
  inputRow, inputEl, hint, memberRow, memberName, memberSub, modalFoot, ghostBtn, ctaBtn,
};
