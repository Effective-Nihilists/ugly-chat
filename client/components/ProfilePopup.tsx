/**
 * ProfilePopup — edit your own display name + avatar.
 *
 * Writes through `userProfileUpdate` (which updates ugly.bot's federated profile
 * AND refreshes the local userPublic cache), so the change is live in-session
 * with no re-login. Rendered in the router portal (outside <AppProvider>), so
 * deps (socket, userId) are passed in by the opener.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { uploadBlob, promoteBlob, downscaleImage } from 'ugly-app/client';
import type { AppSocket } from 'ugly-app/client';
import type { AppRegistry } from '../../shared/api';

type Socket = AppSocket<AppRegistry>;

interface PopupOpener {
  openPopup: (
    content: React.ReactNode,
    opts?: { mode?: 'block' | 'transient' | 'contextMenu' },
  ) => { hide: () => void };
}

export function openProfilePopup(router: PopupOpener, socket: Socket): void {
  const handle = router.openPopup(
    <ProfilePopup onClose={() => handle.hide()} socket={socket} />,
    { mode: 'transient' },
  );
}

function ProfilePopup({
  onClose,
  socket,
}: {
  onClose: () => void;
  socket: Socket;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void socket
      .request('userProfileGet', {})
      .then((p) => {
        if (cancelled) return;
        setName((p as { name?: string | null }).name ?? '');
        setAvatarUrl((p as { avatarUrl?: string | null }).avatarUrl ?? null);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [socket]);

  const pick = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const processed = file.type.startsWith('image/') ? await downscaleImage(file, 1200) : file;
      const { key } = await uploadBlob(processed, { name: file.name });
      const url = await promoteBlob(socket as unknown as Parameters<typeof promoteBlob>[0], key);
      setAvatarUrl(url);
    } catch (err) {
      console.error('[profile] avatar upload failed', err);
    } finally {
      setBusy(false);
    }
  }, [socket]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await socket.request('userProfileUpdate', {
        name: name.trim() || undefined,
        avatarUrl,
      });
      void res;
      onClose();
    } catch (err) {
      console.error('[profile] save failed', err);
      setSaving(false);
    }
  }, [socket, name, avatarUrl, onClose]);

  return (
    <div style={{ width: 340, maxWidth: '92vw', background: 'var(--app-main)', borderRadius: 14, border: '1px solid var(--app-border)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--app-border)' }}>
        <span style={{ fontWeight: 800, fontSize: 16, color: 'var(--app-foreground)' }}>Edit profile</span>
        <button type="button" onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'transparent', color: 'var(--app-foreground-muted)', cursor: 'pointer' }}>
          <X size={18} />
        </button>
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            onClick={() => fileRef.current?.click()}
            title="Change avatar"
            style={{
              width: 72,
              height: 72,
              flexShrink: 0,
              borderRadius: '50%',
              cursor: 'pointer',
              border: '1.5px dashed var(--app-border)',
              background: avatarUrl ? `center / cover no-repeat url(${JSON.stringify(avatarUrl)})` : 'var(--app-tertiary)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--app-foreground-muted)',
              fontSize: 11,
            }}
          >
            {!avatarUrl && !busy ? 'Photo' : null}
            {busy ? '…' : null}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => void pick(e.target.files?.[0])}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--app-foreground-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={loading ? 'Loading…' : 'Your name'}
              maxLength={80}
              style={{ width: '100%', padding: '9px 11px', borderRadius: 9, border: '1px solid var(--app-border)', background: 'var(--app-tertiary)', color: 'var(--app-foreground)', fontSize: 14 }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || busy || loading}
          style={{ padding: '11px 14px', border: 'none', borderRadius: 10, background: 'var(--app-primary)', color: 'var(--app-on-primary)', fontWeight: 800, fontSize: 13, letterSpacing: '0.06em', textTransform: 'uppercase', cursor: saving ? 'default' : 'pointer', opacity: saving || busy || loading ? 0.6 : 1 }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
