/**
 * ParticipantAvatarTile — what a call participant shows when their CAMERA IS OFF
 * (per the call rule): their 3D avatar (GLB) over their avatar background; or,
 * if they have no 3D model, their avatar image cropped to a circle over the
 * background.
 *
 * When `speaking` + an `analyser` are supplied (the participant is talking via
 * TTS), a visible 3D avatar lip-syncs to the audio (TalkingAvatar drives the
 * mouth from the AnalyserNode); when there's no 3D avatar, a simple pulse ring
 * around the circular image indicates audio instead.
 *
 * Generalises BotAvatarTile (same lazy three.js chunk + WebGL/timeout fallback)
 * to any participant + an arbitrary GLB.
 */
import React, { Suspense, useEffect, useState } from 'react';
import type { TalkingAvatarProps } from 'ugly-app/three/client';

const TalkingAvatar = React.lazy(() =>
  import('ugly-app/three/client').then((m) => ({
    default: m.TalkingAvatar as React.ComponentType<TalkingAvatarProps>,
  })),
);

const READY_TIMEOUT_MS = 8000;

function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return '?';
  if (p.length === 1) return (p[0] ?? '?').slice(0, 2).toUpperCase();
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase();
}

class AvatarErrorBoundary extends React.Component<
  { fallback: React.ReactNode; onError: () => void; children: React.ReactNode },
  { failed: boolean }
> {
  constructor(props: { fallback: React.ReactNode; onError: () => void; children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(): void {
    this.props.onError();
  }
  override render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface ParticipantAvatarTileProps {
  name: string;
  /** 3D model (GLB). When absent → circular image fallback. */
  glbUrl?: string | null;
  /** 2D avatar image (circle fallback). */
  imageUrl?: string | null;
  /** Backdrop behind the avatar. */
  backgroundUrl?: string | null;
  /** True while this participant is talking (drives lip-sync / audio pulse). */
  speaking?: boolean;
  /** Audio analyser for lip-sync / the audio visualization. */
  analyser?: AnalyserNode | null;
}

export function ParticipantAvatarTile({
  name,
  glbUrl,
  imageUrl,
  backgroundUrl,
  speaking = false,
  analyser = null,
}: ParticipantAvatarTileProps): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(() => !webglAvailable());
  const use3d = !!glbUrl && !failed;

  // Fall back to the circular image if the GLB never reports ready.
  useEffect(() => {
    if (!use3d || ready) return undefined;
    const t = setTimeout(() => { setFailed(true); }, READY_TIMEOUT_MS);
    return () => { clearTimeout(t); };
  }, [use3d, ready]);

  const bg: React.CSSProperties = backgroundUrl
    ? { backgroundImage: `url(${backgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: 'radial-gradient(circle at 50% 43%, rgba(255,85,0,0.18), transparent 55%), #07080B' };

  const circle = (
    <div style={{ position: 'relative', width: 132, height: 132 }}>
      {speaking && !use3d ? (
        <div
          style={{
            position: 'absolute',
            inset: -8,
            borderRadius: '50%',
            border: '2px solid rgba(255,85,0,0.6)',
            animation: 'uc-ring-pulse 1.2s ease-out infinite',
          }}
        />
      ) : null}
      <div
        style={{
          width: 132,
          height: 132,
          borderRadius: '50%',
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
          background: 'rgba(255,255,255,0.08)',
          border: '1px solid rgba(255,255,255,0.15)',
          fontFamily: 'var(--app-font-heading, sans-serif)',
          fontWeight: 800,
          fontSize: 44,
          color: '#fff',
        }}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          initials(name)
        )}
      </div>
    </div>
  );

  return (
    <div data-id="participant-avatar-tile" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', ...bg }}>
      <style>{`@keyframes uc-ring-pulse {0%{transform:scale(1);opacity:.9}70%{transform:scale(1.25);opacity:0}100%{opacity:0}}`}</style>
      {use3d ? (
        <AvatarErrorBoundary fallback={circle} onError={() => { setFailed(true); }}>
          <Suspense fallback={circle}>
            <TalkingAvatar
              src={glbUrl}
              analyser={analyser}
              speaking={speaking}
              framing="head"
              background="transparent"
              style={{ width: '100%', height: '100%' }}
              onReady={() => { setReady(true); }}
            />
          </Suspense>
        </AvatarErrorBoundary>
      ) : (
        circle
      )}
    </div>
  );
}
