import React from 'react';
import { X } from 'lucide-react';
import { useRouter } from '../router';
import { ThemePicker } from '../components/ThemePicker';
import { newChatStyles as S } from './NewChatPage';

// App-level settings (no conversation). Hosts the ThemePicker so the theme is
// reachable on mobile, where the sidebar (its only other home) is hidden.
export default function SettingsPage(): React.ReactElement {
  const router = useRouter();
  return (
    <div style={S.page}>
      <div style={S.modal}>
        <div style={S.modalHead}>
          <span style={S.modalTitle}>Settings</span>
          <button type="button" aria-label="Close" onClick={() => router.push('chat', {})} style={S.closeBtn}>
            <X size={16} />
          </button>
        </div>
        <div style={S.modalBody}>
          <div style={S.field}>
            <label style={S.fieldLabel}>Theme</label>
            <ThemePicker />
          </div>
          <div style={S.field}>
            <label style={S.fieldLabel}>About</label>
            <div style={{ fontSize: 13, color: 'var(--app-foreground)', opacity: 0.6, lineHeight: 1.5 }}>
              Ugly Chat — chat by email. No usernames, no friend requests.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
