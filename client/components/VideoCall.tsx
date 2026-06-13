import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Text, useApp } from 'ugly-app/client';
import type { DBObject } from 'ugly-app/shared';

interface CallParticipant {
  userId: string;
  isBot: boolean;
  joinedAt: number;
}
interface CallState {
  active: boolean;
  participants: Record<string, CallParticipant>;
}
interface ConversationDoc extends DBObject {
  call?: CallState;
}

const tileBase: React.CSSProperties = {
  aspectRatio: '4 / 3',
  background: '#111',
  borderRadius: 8,
  position: 'relative',
  overflow: 'hidden',
};
const center: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * Video call panel. The call roster comes live from `conversation.call` via
 * trackDoc. Local camera is real (getUserMedia). Bot participants render as a
 * client-side "fake call" avatar tile (no media track). Remote human media is
 * delivered by Cloudflare Realtime in production — until REALTIME_* is wired,
 * remote humans show a placeholder tile while the roster still updates live.
 */
export function VideoCall({ conversationId }: { conversationId: string }): React.ReactElement {
  const { socket, userId } = useApp();
  const [call, setCall] = useState<CallState>({ active: false, participants: {} });
  const [joined, setJoined] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Live roster from conversation.call
  useEffect(() => {
    const unsub = socket.trackDoc<ConversationDoc>('conversation', conversationId, (doc) => {
      setCall(doc?.call ?? { active: false, participants: {} });
    });
    return () => unsub?.();
  }, [socket, conversationId]);

  // Attach the local stream whenever the local tile mounts
  useEffect(() => {
    if (localVideoRef.current && streamRef.current) {
      localVideoRef.current.srcObject = streamRef.current;
    }
  });

  const join = useCallback(async () => {
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      console.warn('[VideoCall] camera/mic unavailable:', err);
    }
    await socket.request('conversationVideoJoin', { conversationId });
    setJoined(true);
  }, [socket, conversationId]);

  const leave = useCallback(async () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    await socket.request('conversationVideoLeave', { conversationId });
    setJoined(false);
  }, [socket, conversationId]);

  const addBot = useCallback(() => {
    void socket
      .request('conversationVideoBotJoin', { conversationId, botId: 'bot-ugly' })
      .catch((err: unknown) => console.error('[VideoCall] add bot failed', err));
  }, [socket, conversationId]);

  const participants = Object.values(call.participants);

  return (
    <div style={{ borderBottom: '1px solid var(--app-border, #ddd)', padding: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {!joined ? (
          <Button size="sm" onClick={() => void join()}>📹 Start video</Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void leave()}>Leave call</Button>
        )}
        {joined && <Button size="sm" variant="secondary" onClick={addBot}>+ Bot</Button>}
        {call.active && (
          <Text size="sm" style={{ opacity: 0.6 }}>
            {participants.length} in call
          </Text>
        )}
      </div>

      {call.active && participants.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 8,
            marginTop: 8,
          }}
        >
          {participants.map((p) => (
            <div key={p.userId} style={tileBase}>
              {p.userId === userId ? (
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : p.isBot ? (
                <div style={{ ...center, fontSize: 40 }}>🤖</div>
              ) : (
                <div style={center}>
                  <Text size="sm" style={{ opacity: 0.5, textAlign: 'center' }}>
                    {p.userId.slice(0, 8)}
                    <br />
                    (Realtime)
                  </Text>
                </div>
              )}
              <div
                style={{
                  position: 'absolute',
                  bottom: 4,
                  left: 6,
                  color: '#fff',
                  fontSize: 11,
                  textShadow: '0 1px 2px #000',
                }}
              >
                {p.isBot ? '🤖 ' : ''}
                {p.userId.slice(0, 8)}
                {p.userId === userId ? ' (you)' : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
