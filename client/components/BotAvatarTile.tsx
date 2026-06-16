/**
 * BotAvatarTile — the 3D ugly-bot head for a call.
 *
 * Renders the framework's `TalkingAvatar` (a three.js scene that lip-syncs to an
 * `AnalyserNode`) and drives it from `useTTS(uglyBotSocket)`. Each new bot turn
 * (`speakText`) is spoken once; `onSubtitleIndex` reports the spoken word's
 * character offset so the caller can reveal the caption karaoke-style.
 *
 * three.js is HEAVY and browser-only, so `TalkingAvatar` is loaded via a
 * client-only dynamic import (`React.lazy`) — it lands in its own chunk, never
 * runs server-side, and never bloats the ChatPage bundle. A `<Suspense>` shows
 * the neutral tile while the chunk + GLB load.
 *
 * Robust fallback (Task 4): if the chunk fails to load, WebGL is unavailable,
 * the GLB never reports ready within a timeout, or `TalkingAvatar` throws, the
 * tile falls back to the neutral gray avatar (matching the rest of the app) —
 * no crash, no white screen. Captions still work because TTS is independent of
 * the render.
 */
import React, { Suspense, useEffect, useRef, useState } from 'react';
import type { TalkingAvatarProps } from 'ugly-app/three/client';
import { useTTS } from 'ugly-app/client';
import type { UglyBotSocket } from 'ugly-app/client';
import { Bot } from 'lucide-react';
import { BOT_AVATAR_URL, ttsVoiceForBot } from '../lib/avatar';

// Client-only chunk: three.js + the avatar scene never reach the server build
// and stay out of the main app bundle.
const TalkingAvatar = React.lazy(() =>
  import('ugly-app/three/client').then((m) => ({
    default: m.TalkingAvatar as React.ComponentType<TalkingAvatarProps>,
  })),
);

// How long we wait for the GLB/WebGL to report `onReady` before giving up and
// showing the neutral fallback (the model is a placeholder until a real GLB is
// hosted, so a failed load must never wedge the call).
const READY_TIMEOUT_MS = 8000;

// Cheap WebGL-availability probe — if the browser can't make a GL context there's
// no point loading the three.js chunk; go straight to the neutral fallback.
function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

interface BotAvatarTileProps {
  socket: UglyBotSocket;
  botId: string;
  /** Latest bot turn to speak, or null. Each distinct value is spoken once. */
  speakText: string | null;
  /** Char offset of the spoken word's end — reveal the caption up to here. */
  onSubtitleIndex?: (charIndex: number) => void;
}

// Neutral fallback tile — the gray avatar used everywhere else in the app. Shown
// while the 3D chunk loads, and permanently if the avatar can't render.
function NeutralBotTile({ label }: { label: string }): React.ReactElement {
  return (
    <div
      data-id="bot-avatar-fallback"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        background: 'var(--app-tertiary, #20232b)',
        color: 'var(--app-foreground-muted, rgba(255,255,255,0.6))',
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 999,
          display: 'grid',
          placeItems: 'center',
          background: 'rgba(255,255,255,0.08)',
        }}
      >
        <Bot size={28} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--app-font-mono)', opacity: 0.7 }}>{label}</span>
    </div>
  );
}

// Catches synchronous render/runtime errors from TalkingAvatar (e.g. WebGL
// context creation throwing) and shows the neutral fallback instead of letting
// the whole call tree white-screen.
class AvatarErrorBoundary extends React.Component<
  { fallback: React.ReactNode; onError: () => void; children: React.ReactNode },
  { failed: boolean }
> {
  constructor(props: {
    fallback: React.ReactNode;
    onError: () => void;
    children: React.ReactNode;
  }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    console.warn('[BotAvatarTile] avatar render failed, falling back', error);
    this.props.onError();
  }
  override render(): React.ReactNode {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

export function BotAvatarTile({
  socket,
  botId,
  speakText,
  onSubtitleIndex,
}: BotAvatarTileProps): React.ReactElement {
  const tts = useTTS(socket);
  const [ready, setReady] = useState(false);
  // Pre-fail when WebGL is unavailable so we never load the heavy chunk.
  const [failed, setFailed] = useState(() => !webglAvailable());
  // Pause the avatar (unmount the render loop) when the tab is hidden — saves
  // battery; remounting on re-show reloads fast from the warm chunk cache.
  const [hidden, setHidden] = useState(
    () => typeof document !== 'undefined' && document.hidden,
  );
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVis = (): void => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  // Stop any in-flight speech on unmount (call end) so audio doesn't outlive the
  // tile. TalkingAvatar disposes its three.js context on its own unmount.
  const stopRef = useRef(tts.stop);
  stopRef.current = tts.stop;
  useEffect(
    () => () => {
      stopRef.current();
    },
    [],
  );

  // Warm the AudioContext on mount (BotAvatarTile only mounts once the user has
  // already gestured to join/add-bot, so the context can unlock here on Safari).
  useEffect(() => {
    void tts.warmup().catch(() => undefined);
    // warmup identity is stable per hook instance; run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Speak each new bot turn exactly once. `speakText` changing to a new
  // non-null value triggers playback; the caller swaps it per bot message.
  const onSubRef = useRef(onSubtitleIndex);
  onSubRef.current = onSubtitleIndex;
  useEffect(() => {
    if (!speakText) return;
    void tts
      .play(speakText, {
        voice: ttsVoiceForBot(botId),
        onSubtitleIndex: (i) => onSubRef.current?.(i),
      })
      .catch((err: unknown) => {
        console.warn('[BotAvatarTile] tts.play failed', err);
      });
    // Re-run only when the text to speak changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakText, botId]);

  // If onReady never fires within the timeout (slow/missing GLB, no WebGL),
  // fall back to the neutral tile. Cleared if it does become ready.
  useEffect(() => {
    if (ready || failed || hidden) return undefined;
    const t = setTimeout(() => {
      console.warn('[BotAvatarTile] avatar not ready in time, falling back');
      setFailed(true);
    }, READY_TIMEOUT_MS);
    return () => {
      clearTimeout(t);
    };
  }, [ready, failed, hidden]);

  const label = 'ugly-bot';

  return (
    <div
      data-id="bot-avatar-tile"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        // Dark stage + soft orange radial glow behind the head (mock parity).
        background:
          'radial-gradient(circle at 50% 43%, rgba(255,85,0,0.18), transparent 55%), #07080B',
      }}
    >
      {failed || hidden ? (
        <NeutralBotTile label={label} />
      ) : (
        <AvatarErrorBoundary
          fallback={<NeutralBotTile label={label} />}
          onError={() => setFailed(true)}
        >
          <Suspense fallback={<NeutralBotTile label={label} />}>
            <TalkingAvatar
              src={BOT_AVATAR_URL}
              analyser={tts.analyser}
              speaking={tts.playing}
              framing="head"
              background="transparent"
              style={{ width: '100%', height: '100%' }}
              onReady={() => setReady(true)}
            />
          </Suspense>
        </AvatarErrorBoundary>
      )}
    </div>
  );
}
