import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button, Text, useApp } from 'ugly-app/client';
import type { DBObject } from 'ugly-app/shared';

export interface VideoCallHandle {
  start: () => void;
}

interface CallParticipant {
  userId: string;
  isBot: boolean;
  joinedAt: number;
  sessionId?: string;
  tracks?: string[];
}
interface CallState {
  active: boolean;
  participants: Record<string, CallParticipant>;
}
interface ConversationDoc extends DBObject {
  call?: CallState;
}

// Cloudflare Realtime track/SDP wire shapes (subset we use).
interface SdpMessage { type: 'offer' | 'answer'; sdp: string }
interface TracksResponse {
  sessionDescription?: SdpMessage;
  requiresImmediateRenegotiation?: boolean;
  tracks?: { mid?: string; trackName?: string }[];
}

const tileBase: React.CSSProperties = {
  aspectRatio: '4 / 3',
  background: '#111',
  borderRadius: 8,
  position: 'relative',
  overflow: 'hidden',
};
const center: React.CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
};

/**
 * Video call panel on Cloudflare Realtime (SFU). One RTCPeerConnection per
 * client: we PUSH local camera/mic tracks (the client offers, the SFU answers),
 * advertise `{sessionId, trackNames}` on `conversation.call` (trackDocs), and
 * for every peer on the roster we PULL their tracks (the SFU offers, we answer
 * via renegotiate). The SFU app secret never reaches the browser — all SDP goes
 * through the server-brokered `realtime*` RPCs. Bots render as a "fake call"
 * avatar tile (no media).
 */
export const VideoCall = forwardRef<VideoCallHandle, { conversationId: string }>(function VideoCall(
  { conversationId },
  ref,
) {
  const { socket, userId } = useApp();
  const [call, setCall] = useState<CallState>({ active: false, participants: {} });
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sessionIdRef = useRef<string>('');
  const pulledRef = useRef<Set<string>>(new Set());
  const midToUserRef = useRef<Map<string, string>>(new Map());
  // Serialize renegotiations — overlapping setLocal/RemoteDescription corrupts state.
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  // Live roster from conversation.call
  useEffect(() => {
    const unsub = socket.trackDoc<ConversationDoc>('conversation', conversationId, (doc) => {
      setCall(doc?.call ?? { active: false, participants: {} });
    });
    return () => unsub?.();
  }, [socket, conversationId]);

  // Attach the local stream when the tile mounts.
  useEffect(() => {
    if (localVideoRef.current && streamRef.current) {
      localVideoRef.current.srcObject = streamRef.current;
    }
  });

  // Run a negotiation step serialized on one chain — overlapping
  // setLocal/RemoteDescription (e.g. the local push colliding with a pull)
  // corrupts the RTCPeerConnection, so EVERYTHING goes through here.
  const negotiate = useCallback((fn: () => Promise<void>): void => {
    chainRef.current = chainRef.current.then(fn).catch((err: unknown) => {
      console.error('[VideoCall] negotiate failed', err);
    });
  }, []);

  // Pull every peer's not-yet-pulled tracks (batched per peer = one
  // renegotiation), serialized via `negotiate`. Idempotent through pulledRef.
  const pullPeers = useCallback((participants: Record<string, CallParticipant>) => {
    const pc = pcRef.current;
    const mySession = sessionIdRef.current;
    if (!pc || !mySession) return;
    for (const p of Object.values(participants)) {
      if (p.userId === userId || p.isBot || !p.sessionId || !p.tracks?.length) continue;
      const peerSession = p.sessionId;
      const fresh = p.tracks.filter((tn) => !pulledRef.current.has(`${peerSession}/${tn}`));
      if (fresh.length === 0) continue;
      for (const tn of fresh) pulledRef.current.add(`${peerSession}/${tn}`);
      const peerUserId = p.userId;
      const keys = fresh.map((tn) => `${peerSession}/${tn}`);
      negotiate(async () => {
        try {
          const resp = (await socket.request('realtimeTracks', {
            sessionId: mySession,
            body: { tracks: fresh.map((trackName) => ({ location: 'remote', sessionId: peerSession, trackName })) },
          })) as TracksResponse & { errorCode?: number; errorDescription?: string };
          if (resp.errorCode) throw new Error(`SFU pull ${resp.errorCode}: ${resp.errorDescription ?? ''}`);
          for (const t of resp.tracks ?? []) {
            if (t.mid) midToUserRef.current.set(t.mid, peerUserId);
          }
          if (resp.requiresImmediateRenegotiation && resp.sessionDescription) {
            await pc.setRemoteDescription(resp.sessionDescription);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            await socket.request('realtimeRenegotiate', {
              sessionId: mySession,
              body: { sessionDescription: { type: 'answer', sdp: answer.sdp } },
            });
          }
        } catch (err) {
          // Un-mark so the next poll retries (transient SFU/reneg failure).
          keys.forEach((k) => pulledRef.current.delete(k));
          throw err;
        }
      });
    }
  }, [socket, userId, negotiate]);

  // React immediately to roster updates we DO receive…
  useEffect(() => {
    if (joined) pullPeers(call.participants);
  }, [joined, call.participants, pullPeers]);

  // …but trackDoc delivery can be stale/coalesced, so also poll the
  // AUTHORITATIVE roster (getDoc) and pull from it. Idempotent via pulledRef;
  // failed pulls are removed so they retry. This is what makes the call
  // reliably bidirectional regardless of trackDoc timing.
  useEffect(() => {
    if (!joined) return;
    const t = setInterval(() => {
      // Fresh SERVER read — client getDoc only returns the stale trackDoc cache.
      void socket
        .request('conversationVideoState', { conversationId })
        .then((c) => {
          const call = c as CallState | null;
          if (call) setCall(call); // keep the RENDER roster fresh too
          pullPeers(call?.participants ?? {});
        })
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(t);
  }, [joined, socket, conversationId, pullPeers]);

  const join = useCallback(async () => {
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      if (localVideoRef.current) localVideoRef.current.srcObject = streamRef.current;
    } catch (err) {
      console.warn('[VideoCall] camera/mic unavailable:', err);
    }
    await socket.request('conversationVideoJoin', { conversationId });
    setJoined(true);

    // ── Cloudflare Realtime: publish local media ──────────────────────────
    try {
      const ice = (await socket.request('realtimeIceServers', {})) as { iceServers?: RTCIceServer[] };
      const pc = new RTCPeerConnection({
        iceServers: ice.iceServers ?? [],
        bundlePolicy: 'max-bundle',
      });
      pcRef.current = pc;
      pc.addEventListener('track', (e) => {
        const mid = e.transceiver?.mid ?? '';
        const uid = midToUserRef.current.get(mid);
        if (!uid) return;
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          const ms = next.get(uid) ?? new MediaStream();
          if (!ms.getTracks().includes(e.track)) ms.addTrack(e.track);
          next.set(uid, ms);
          return next;
        });
      });
      pc.addEventListener('connectionstatechange', () => setStatus(pc.connectionState));

      const { sessionId } = (await socket.request('realtimeNewSession', {})) as { sessionId: string };
      sessionIdRef.current = sessionId;

      // Push local tracks + advertise them — as the FIRST step on the
      // negotiation chain, so the offer/answer can't overlap a pull.
      negotiate(async () => {
        const stream = streamRef.current;
        if (!stream) return;
        const transceivers = stream
          .getTracks()
          .map((track) => pc.addTransceiver(track, { direction: 'sendonly' }));
        await pc.setLocalDescription(await pc.createOffer());
        const localTracks = transceivers
          .filter((t) => t.mid)
          .map((t) => ({ location: 'local' as const, mid: t.mid as string, trackName: `${userId}-${t.sender.track?.kind ?? 'track'}` }));
        const resp = (await socket.request('realtimeTracks', {
          sessionId,
          body: { sessionDescription: { type: 'offer', sdp: pc.localDescription?.sdp }, tracks: localTracks },
        })) as TracksResponse;
        if (resp.sessionDescription) await pc.setRemoteDescription(resp.sessionDescription);
        await socket.request('conversationVideoPublish', {
          conversationId,
          sessionId,
          tracks: localTracks.map((t) => t.trackName),
        });
      });
    } catch (err) {
      console.error('[VideoCall] realtime publish failed', err);
      setStatus('error');
    }
  }, [socket, conversationId, userId, negotiate]);

  const leave = useCallback(async () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    sessionIdRef.current = '';
    pulledRef.current.clear();
    midToUserRef.current.clear();
    setRemoteStreams(new Map());
    await socket.request('conversationVideoLeave', { conversationId });
    setJoined(false);
  }, [socket, conversationId]);

  const addBot = useCallback(() => {
    void socket
      .request('conversationVideoBotJoin', { conversationId, botId: 'bot-ugly' })
      .catch((err: unknown) => console.error('[VideoCall] add bot failed', err));
  }, [socket, conversationId]);

  useImperativeHandle(ref, () => ({ start: () => void join() }), [join]);

  const participants = Object.values(call.participants);
  if (!call.active && !joined) return null;

  return (
    <div data-id="video-call" style={{ borderBottom: '1px solid var(--app-border, #ddd)', padding: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button size="sm" variant="secondary" onClick={() => void leave()}>Leave call</Button>
        {joined && <Button size="sm" variant="secondary" onClick={addBot}>+ Bot</Button>}
        {call.active && (
          <Text size="sm" style={{ opacity: 0.6 }}>
            {participants.length} in call{status ? ` · ${status}` : ''}
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
            <div key={p.userId} data-id={`call-tile-${p.userId === userId ? 'self' : 'peer'}`} style={tileBase}>
              {p.userId === userId ? (
                <video ref={localVideoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : p.isBot ? (
                <div style={{ ...center, fontSize: 40 }}>🤖</div>
              ) : remoteStreams.has(p.userId) ? (
                <RemoteTile stream={remoteStreams.get(p.userId)!} />
              ) : (
                <div style={center}>
                  <Text size="sm" style={{ opacity: 0.5, textAlign: 'center' }}>
                    {p.userId.slice(0, 8)}
                    <br />
                    connecting…
                  </Text>
                </div>
              )}
              <div style={{ position: 'absolute', bottom: 4, left: 6, color: '#fff', fontSize: 11, textShadow: '0 1px 2px #000' }}>
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
});

// Remote peer tile — binds the pulled MediaStream to a <video>.
function RemoteTile({ stream }: { stream: MediaStream }): React.ReactElement {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline data-id="remote-video" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}
