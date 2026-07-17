import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useApp, useTTS } from 'ugly-app/client';
import type { UglyBotSocket } from 'ugly-app/client';
import type { DBObject } from 'ugly-app/shared';
import { Mic, MicOff, Video, VideoOff, Captions, UserPlus, Bot as BotIcon, PhoneOff } from 'lucide-react';
import { BotAvatarTile } from './BotAvatarTile';
import { ParticipantAvatarTile } from './call/ParticipantAvatarTile';
import type { DevicePrefs } from './call/useAvDevices';
import { classifyMediaError } from './call/mediaErrors';

export interface VideoCallHandle {
  /** Join the call with the device prefs chosen in the lobby. */
  start: (prefs?: DevicePrefs) => void;
  /** Leave the call (used by CallLayout for programmatic teardown). */
  leave: () => void;
}

// A bot message reduced to what the avatar tile needs to speak it. `created` is
// a Date in the schema but arrives serialized over trackDocs — `toMs` normalizes.
interface MessageDoc extends DBObject {
  conversationId: string;
  userId: string;
  text?: string | null;
  markdown?: string | null;
  deleted?: boolean;
  systemType?: string;
}

const toMs = (v: unknown): number =>
  v instanceof Date ? v.getTime() : typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : 0;

// Minimal profile shape (name + avatar) — supplied by ChatPage's resolved roster
// so call tiles/chips never show a raw `5c0e5c0e…` id.
export interface CallProfile {
  name?: string;
  avatarUrl?: string | null;
  /** 3D avatar (GLB) — shown when the camera is off. */
  avatarGlbUrl?: string | null;
  /** Avatar backdrop image — behind the 3D model / circular image. */
  backgroundUrl?: string | null;
}
export type CallProfiles = Record<string, CallProfile>;

export interface VideoCallProps {
  conversationId: string;
  /** ugly.bot socket for bot TTS (null when unavailable → emoji fallback). */
  uglyBotSocket?: UglyBotSocket | null;
  /**
   * Called as the bot's TTS reveals each word, so the caller can mirror the
   * spoken text into the call transcript (`final` once the turn is done).
   */
  onBotTurn?: (botId: string, text: string, final: boolean) => void;
  /** Resolved roster (real names + avatars) — keyed by userId. */
  profiles?: CallProfiles;
  /** The bot's configured model label, for the HUD stat line (no fabrication). */
  botModel?: string | null;
  /**
   * The conversation's bot id (bot DMs / custom-bot rooms). When set, the bot
   * auto-joins once the local user has joined the call — so the centered 3D
   * BotAvatarTile mounts without the user clicking "Add ugly-bot". Null for
   * human DMs / groups (the manual add button still works).
   */
  autoJoinBotId?: string | null;
  /** Whether the transcript panel is collapsed (controls the captions toggle). */
  transcriptCollapsed?: boolean;
  /** Toggle the transcript panel / subtitles (owned by CallLayout). */
  onToggleTranscript?: () => void;
  /** Add-person handler (group calls). When omitted the add control is hidden. */
  onAddPerson?: () => void;
  /** Subtitle overlay rendered over the stage (shown when collapsed). */
  subtitleSlot?: React.ReactNode;
  /** Fires when the local user joins/leaves — lets CallLayout drive the view
   *  off LOCAL participation (so leaving exits call mode even if a peer/bot stays). */
  onJoinedChange?: (joined: boolean) => void;
  /** Surface a media/permission error to the host (e.g. mic/cam vanished mid-join). */
  onCallError?: (message: string) => void;
}

interface CallParticipant {
  userId: string;
  isBot: boolean;
  joinedAt: number;
  /** Published mic/cam state — absent means on. */
  micOn?: boolean;
  camOn?: boolean;
  sessionId?: string;
  tracks?: string[];
}
interface CallCaptionDoc {
  userId: string;
  text: string;
  final: boolean;
  at: number;
  typed?: boolean;
}
interface CallState {
  active: boolean;
  participants: Record<string, CallParticipant>;
  captions?: Record<string, CallCaptionDoc>;
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

// ── Immersive stage palette (fixed dark/light-on-dark in EVERY theme) ─────────
const C = {
  stageBg:
    'radial-gradient(circle at 50% 38%, rgba(255,85,0,0.10), transparent 58%),' +
    ' radial-gradient(circle at 50% 90%, rgba(59,130,246,0.06), transparent 55%), #07080B',
  hairline: 'rgba(255,255,255,0.12)',
  panel: 'rgba(8,9,11,0.72)',
  textOnDark: '#fff',
  faintOnDark: 'rgba(255,255,255,0.4)',
  brand: '#ff5500',
  brandGrad: 'linear-gradient(135deg, #ff8a4d 0%, #ff5500 50%, #d2470f 100%)',
  brandGlow: 'rgba(255,85,0,0.30)',
};

function resolveName(id: string, meId: string, isBot: boolean, profiles: CallProfiles): string {
  if (isBot) return profiles[id]?.name ?? 'ugly-bot';
  return profiles[id]?.name ?? id.slice(0, 8);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * Video call panel on Cloudflare Realtime (SFU). One RTCPeerConnection per
 * client: we PUSH local camera/mic tracks (the client offers, the SFU answers),
 * advertise `{sessionId, trackNames}` on `conversation.call` (trackDocs), and
 * for every peer on the roster we PULL their tracks (the SFU offers, we answer
 * via renegotiate). The SFU app secret never reaches the browser — all SDP goes
 * through the server-brokered `realtime*` RPCs. Bots render as a "fake call"
 * avatar tile (no media).
 *
 * NOTE: the SFU / track / renegotiation logic below is unchanged — only the
 * RENDER (the immersive stage: HUD, tiles, controls, self-PiP) is restyled to
 * match mockups/call-bot.html + call-2p.html.
 */
export const VideoCall = forwardRef<VideoCallHandle, VideoCallProps>(function VideoCall(
  {
    conversationId,
    uglyBotSocket = null,
    onBotTurn,
    profiles = {},
    botModel = null,
    autoJoinBotId = null,
    transcriptCollapsed = false,
    onToggleTranscript,
    onAddPerson,
    subtitleSlot,
    onJoinedChange,
    onCallError,
  },
  ref,
) {
  const { socket, userId } = useApp();
  const [call, setCall] = useState<CallState>({ active: false, participants: {} });
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  // Speaker (audiooutput) chosen in the lobby — applied to remote media via
  // setSinkId. Empty = system default.
  const [speakerId, setSpeakerId] = useState<string>('');

  // Notify the host whenever local join state flips (drives exit-call view).
  const onJoinedChangeRef = useRef(onJoinedChange);
  onJoinedChangeRef.current = onJoinedChange;
  useEffect(() => {
    onJoinedChangeRef.current?.(joined);
  }, [joined]);

  // ── Speak a peer's TYPED message via TTS (so silent typed text is heard) ────
  // STT captions are live mic audio (already heard over the SFU) → never spoken.
  // The speaking peer's tile lip-syncs (3D avatar) / pulses (audio viz) off the
  // shared TTS analyser. Bots speak via their own BotAvatarTile path.
  const peerTts = useTTS(uglyBotSocket!);
  const [speakingPeerId, setSpeakingPeerId] = useState<string | null>(null);
  const spokenCaptionAt = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!joined || !uglyBotSocket) return;
    const captions = call.captions ?? {};
    for (const cap of Object.values(captions)) {
      if (!cap.typed || !cap.final || cap.userId === userId) continue;
      if (spokenCaptionAt.current.get(cap.userId) === cap.at) continue;
      spokenCaptionAt.current.set(cap.userId, cap.at);
      setSpeakingPeerId(cap.userId);
      void peerTts
        .play(cap.text)
        .catch((err: unknown) => { console.warn('[VideoCall] peer TTS failed', err); })
        .finally(() => { setSpeakingPeerId((cur) => (cur === cap.userId ? null : cur)); });
    }
  }, [call.captions, joined, uglyBotSocket, userId, peerTts]);

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
    return () => { unsub(); };
  }, [socket, conversationId]);

  // ── Bot speech ───────────────────────────────────────────────────────────
  // The bot speaks its newest message once. We watch the message stream and,
  // when a fresh bot message arrives, stash its text as the tile's `speakText`.
  // `spokenIds` guards against re-speaking on every trackDocs re-emit. This is
  // purely additive — it never touches the SFU/track/renegotiation path.
  const [pendingBotText, setPendingBotText] = useState<{ botId: string; text: string } | null>(null);
  const spokenIds = useRef<Set<string>>(new Set());
  const joinedAtRef = useRef<number>(0);
  useEffect(() => {
    if (!joined || !uglyBotSocket) return undefined;
    if (!joinedAtRef.current) joinedAtRef.current = Date.now();
    const unsub = socket.trackDocs<MessageDoc>(
      'message',
      { keys: { conversationId }, sort: { created: -1 }, limit: 20 },
      (docs) => {
        const list = Array.isArray(docs) ? docs : [];
        // Newest bot, non-system, non-deleted message after we joined the call.
        const latest = list
          .filter(
            (d) =>
              !d.deleted &&
              !d.systemType &&
              d.userId.startsWith('bot-') &&
              (!!d.text || !!d.markdown) &&
              toMs(d.created) >= joinedAtRef.current,
          )
          .sort((a, b) => toMs(b.created) - toMs(a.created))[0];
        if (!latest || spokenIds.current.has(latest._id)) return;
        spokenIds.current.add(latest._id);
        setPendingBotText({ botId: latest.userId, text: latest.text ?? latest.markdown ?? '' });
      },
    );
    return () => {
      unsub();
    };
  }, [joined, uglyBotSocket, socket, conversationId]);

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
    return () => { clearInterval(t); };
  }, [joined, socket, conversationId, pullPeers]);

  const join = useCallback(async (prefs?: DevicePrefs) => {
    if (prefs?.speakerId) setSpeakerId(prefs.speakerId);
    // Acquire local media with the lobby-chosen devices. Permission was already
    // granted in the lobby, so this won't re-prompt — but if it fails (device
    // unplugged, busy) SURFACE it instead of the old silent console.warn, and do
    // NOT proceed to publish an empty session (which left both sides black).
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        video: prefs?.cameraId ? { deviceId: { exact: prefs.cameraId } } : true,
        audio: prefs?.micId ? { deviceId: { exact: prefs.micId } } : true,
      });
      if (localVideoRef.current) localVideoRef.current.srcObject = streamRef.current;
    } catch (err) {
      const c = classifyMediaError(err);
      console.error('[VideoCall] getUserMedia failed:', err);
      onCallError?.(c.help);
      setStatus('error');
      return; // abort join — don't publish a track-less session
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
      // Test hook: lets the e2e read RTCPeerConnection.getStats() to prove real
      // inbound media (framesDecoded/bytesReceived). Harmless in production.
      if (typeof window !== 'undefined') (window as Window & { __ucpc?: RTCPeerConnection }).__ucpc = pc;
      pc.addEventListener('track', (e) => {
        const mid = e.transceiver.mid ?? '';
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
      pc.addEventListener('connectionstatechange', () => { setStatus(pc.connectionState); });

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
          .map((t) => ({ location: 'local' as const, mid: t.mid!, trackName: `${userId}-${t.sender.track?.kind ?? 'track'}` }));
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
  }, [socket, conversationId, userId, negotiate, onCallError]);

  const leave = useCallback(async () => {
    streamRef.current?.getTracks().forEach((t) => { t.stop(); });
    streamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    sessionIdRef.current = '';
    pulledRef.current.clear();
    midToUserRef.current.clear();
    setRemoteStreams(new Map());
    spokenIds.current.clear();
    joinedAtRef.current = 0;
    setPendingBotText(null);
    await socket.request('conversationVideoLeave', { conversationId });
    setJoined(false);
  }, [socket, conversationId]);

  const addBot = useCallback(
    (botId = 'bot-ugly') => {
      void socket
        .request('conversationVideoBotJoin', { conversationId, botId })
        .catch((err: unknown) => { console.error('[VideoCall] add bot failed', err); });
    },
    [socket, conversationId],
  );

  // Auto-join the conversation's bot once, after the local user joins a call in a
  // bot conversation, so the centered 3D BotAvatarTile mounts (without the user
  // clicking "Add ugly-bot"). Guarded by a ref so the roster poll can't re-fire
  // it. Purely invokes the existing bot-join RPC — no SFU/track changes.
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (!joined || !autoJoinBotId) return;
    if (autoJoinedRef.current) return;
    const hasBot = Object.values(call.participants).some((p) => p.isBot);
    if (hasBot) return;
    autoJoinedRef.current = true;
    addBot(autoJoinBotId);
  }, [joined, autoJoinBotId, call.participants, addBot]);

  // Reset the auto-join guard when leaving so a re-join re-invites the bot.
  useEffect(() => {
    if (!joined) autoJoinedRef.current = false;
  }, [joined]);

  useImperativeHandle(ref, () => ({ start: (prefs?: DevicePrefs) => void join(prefs), leave: () => void leave() }), [join, leave]);

  // ── Local device toggles (render-level only — flips track.enabled; never
  // touches the SFU/track/renegotiation path). ───────────────────────────────
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  // Publish mic/cam to the roster so PEERS can show it. Flipping only the local
  // track's `enabled` left the other side with silence / a black rectangle and
  // no idea why.
  const publishMedia = useCallback(
    (mic: boolean, cam: boolean) => {
      void socket
        .request('conversationVideoMedia', { conversationId, micOn: mic, camOn: cam })
        .catch(() => undefined);
    },
    [socket, conversationId],
  );
  const toggleMic = useCallback(() => {
    setMicOn((on) => {
      const next = !on;
      streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
      publishMedia(next, camOn);
      return next;
    });
  }, [publishMedia, camOn]);
  const toggleCam = useCallback(() => {
    setCamOn((on) => {
      const next = !on;
      streamRef.current?.getVideoTracks().forEach((t) => (t.enabled = next));
      publishMedia(micOn, next);
      return next;
    });
  }, [publishMedia, micOn]);

  // ── Elapsed-call timer (real time from local join). ─────────────────────────
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!joined) return undefined;
    if (!joinedAtRef.current) joinedAtRef.current = Date.now();
    const id = setInterval(() => { setNow(Date.now()); }, 1000);
    return () => { clearInterval(id); };
  }, [joined]);
  const elapsed = joined && joinedAtRef.current ? now - joinedAtRef.current : 0;

  const participants = Object.values(call.participants);

  // Resolve the "other" participant for the name-chip (first non-self).
  const other = useMemo(
    () => participants.find((p) => p.userId !== userId) ?? null,
    [participants, userId],
  );
  const botParticipant = useMemo(() => participants.find((p) => p.isBot) ?? null, [participants]);

  // Render the immersive stage ONLY when the LOCAL user has joined. A peer (or a
  // never-leaving bot) keeping `call.active` true must not strand us on an empty
  // stage after we leave — CallLayout shows the incoming-call ring for the
  // not-yet-joined case instead.
  if (!joined) return null;

  const connState = status || 'connecting';
  const otherName = other ? resolveName(other.userId, userId, other.isBot, profiles) : 'ugly-bot';
  const otherState = botParticipant ? (pendingBotText ? 'speaking' : 'in call') : 'in call';

  // HUD stat line — REAL values only. Bot call → model · live; else → roster.
  // `status` is OUR connection to the SFU, so sitting alone in a call read
  // "1 in call · connected" — the app claiming a connection to nobody. Until a
  // second human is actually on the roster, say we're ringing.
  const otherHumans = participants.filter((p) => p.userId !== userId && !p.isBot);
  const statLine = botParticipant
    ? `${botModel ? `${botModel} · ` : ''}live`
    : otherHumans.length === 0
      ? 'ringing · nobody has joined yet'
      : `${participants.length} in call${connState ? ` · ${connState}` : ''}`;

  return (
    <div
      data-id="video-call"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: C.stageBg,
      }}
    >
      {/* ── viewport corner brackets ──────────────────────────────────────── */}
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => {
        const base: React.CSSProperties = {
          position: 'absolute',
          width: 16,
          height: 16,
          border: `1px solid rgba(255,255,255,0.18)`,
          pointerEvents: 'none',
        };
        const pos: Record<string, React.CSSProperties> = {
          tl: { top: 14, left: 14, borderRight: 'none', borderBottom: 'none' },
          tr: { top: 14, right: 14, borderLeft: 'none', borderBottom: 'none' },
          bl: { bottom: 14, left: 14, borderRight: 'none', borderTop: 'none' },
          br: { bottom: 14, right: 14, borderLeft: 'none', borderTop: 'none' },
        };
        return <span key={c} style={{ ...base, ...pos[c] }} aria-hidden />;
      })}

      {/* ── HUD top-left: LIVE timer + real stat line ─────────────────────── */}
      <div style={{ position: 'absolute', top: 18, left: 18, zIndex: 4, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            fontFamily: 'var(--app-font-mono, monospace)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.1em',
            color: C.textOnDark,
          }}
        >
          <span className="uc-call-rec" style={{ width: 8, height: 8, background: '#f87171', borderRadius: '50%' }} />
          LIVE · {fmtClock(elapsed)}
        </span>
        <span
          style={{
            fontFamily: 'var(--app-font-mono, monospace)',
            fontSize: 10,
            color: C.faintOnDark,
            letterSpacing: '0.06em',
          }}
        >
          {statLine}
        </span>
      </div>

      {/* ── name-chip top-right ───────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 18,
          right: 18,
          zIndex: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '7px 11px',
          border: `1px solid ${C.hairline}`,
          background: 'rgba(0,0,0,0.45)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 22,
            height: 22,
            display: 'grid',
            placeItems: 'center',
            fontSize: 9,
            fontWeight: 800,
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.18)',
            color: '#fff',
            fontFamily: 'var(--app-font-heading, sans-serif)',
          }}
        >
          {botParticipant ? <BotIcon size={12} /> : initials(otherName)}
        </span>
        <div>
          <div style={{ fontFamily: 'var(--app-font-heading, sans-serif)', fontWeight: 700, fontSize: 12, color: '#fff' }}>
            {otherName}
          </div>
          <div style={{ fontFamily: 'var(--app-font-mono, monospace)', fontSize: 9, color: C.brand, letterSpacing: '0.08em' }}>
            {otherState}
          </div>
        </div>
      </div>

      {/* ── tiles / stage centre ──────────────────────────────────────────── */}
      {botParticipant ? (
        // BOT call — centered avatar fills the stage; self is a PiP.
        <div style={{ position: 'absolute', inset: 0 }} data-id="call-tile-peer">
          {uglyBotSocket ? (
            <BotAvatarTile
              socket={uglyBotSocket}
              botId={botParticipant.userId}
              speakText={
                pendingBotText?.botId === botParticipant.userId ? pendingBotText.text : null
              }
              onSubtitleIndex={(i) => {
                const full =
                  pendingBotText?.botId === botParticipant.userId ? pendingBotText.text : '';
                if (!full) return;
                const revealed = full.slice(0, i);
                onBotTurn?.(botParticipant.userId, revealed, i >= full.length);
              }}
            />
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: C.faintOnDark }}>
              ugly-bot
            </div>
          )}
        </div>
      ) : (
        // 1:1 / 2-person — remote large; self is a PiP in the corner.
        <div style={{ position: 'absolute', inset: 0 }}>
          {other ? (
            <div data-id="call-tile-peer" style={{ position: 'absolute', inset: 0 }}>
              {/* `camOn === false` matters: turning a camera off only disables the
                  track, so the stream still exists and RemoteTile rendered a solid
                  BLACK rectangle — no avatar, no name, no reason. Fall back to the
                  avatar tile the app already has. */}
              {remoteStreams.has(other.userId) && other.camOn !== false ? (
                <>
                  <RemoteTile stream={remoteStreams.get(other.userId)!} speakerId={speakerId} />
                  {/* Camera on (no avatar) → a simple audio pulse when speaking. */}
                  {speakingPeerId === other.userId ? <SpeakingPulse /> : null}
                </>
              ) : (
                // No remote video yet (camera off, or still connecting) → show
                // the peer's avatar (3D over background, or circular image). When
                // they speak a typed message, the avatar lip-syncs to the TTS.
                <ParticipantAvatarTile
                  name={resolveName(other.userId, userId, other.isBot, profiles)}
                  glbUrl={profiles[other.userId]?.avatarGlbUrl ?? null}
                  imageUrl={profiles[other.userId]?.avatarUrl ?? null}
                  backgroundUrl={profiles[other.userId]?.backgroundUrl ?? null}
                  speaking={speakingPeerId === other.userId}
                  analyser={peerTts.analyser}
                />
              )}
              <span
                style={{
                  position: 'absolute',
                  left: 16,
                  bottom: 16,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  background: 'rgba(0,0,0,0.55)',
                  backdropFilter: 'blur(8px)',
                  fontFamily: 'var(--app-font-heading, sans-serif)',
                  fontWeight: 700,
                  fontSize: 13,
                  color: '#fff',
                  zIndex: 3,
                }}
              >
                {resolveName(other.userId, userId, other.isBot, profiles)}
                {/* Peers had no way to know you'd muted — the audio just stopped. */}
                {other.micOn === false ? <MicOff size={13} data-id="peer-muted" /> : null}
                {other.camOn === false ? <VideoOff size={13} data-id="peer-cam-off" /> : null}
              </span>
            </div>
          ) : (
            <PeerPlaceholder name="Waiting for others…" />
          )}
        </div>
      )}

      {/* ── self PiP bottom-right ─────────────────────────────────────────── */}
      <div
        data-id="call-tile-self"
        style={{
          position: 'absolute',
          right: 18,
          bottom: 88,
          width: 132,
          height: 92,
          border: '1px solid rgba(255,255,255,0.2)',
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #2a2d35, #14161b)',
          zIndex: 4,
        }}
      >
        <video
          ref={localVideoRef}
          autoPlay
          muted
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: camOn ? 'block' : 'none' }}
        />
        {!camOn ? (
          // Camera off → show MY avatar (3D model over the avatar background, or
          // a circular image fallback) instead of a blank tile.
          <ParticipantAvatarTile
            name={resolveName(userId, userId, false, profiles)}
            glbUrl={profiles[userId]?.avatarGlbUrl ?? null}
            imageUrl={profiles[userId]?.avatarUrl ?? null}
            backgroundUrl={profiles[userId]?.backgroundUrl ?? null}
          />
        ) : null}
        <span
          style={{
            position: 'absolute',
            left: 6,
            bottom: 5,
            fontFamily: 'var(--app-font-mono, monospace)',
            fontSize: 9,
            color: '#fff',
            textShadow: '0 1px 3px #000',
            letterSpacing: '0.06em',
          }}
        >
          you
        </span>
        {!micOn ? (
          <span style={{ position: 'absolute', right: 6, bottom: 5, color: '#f87171', display: 'grid', placeItems: 'center' }}>
            <MicOff size={13} />
          </span>
        ) : null}
      </div>

      {/* ── subtitle overlay slot (shown when transcript collapsed) ───────── */}
      {subtitleSlot}

      {/* ── control bar, floating bottom-center ───────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 20,
          transform: 'translateX(-50%)',
          zIndex: 5,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: 9,
          border: `1px solid ${C.hairline}`,
          background: C.panel,
          backdropFilter: 'blur(12px)',
        }}
      >
        <CtrlButton
          dataId="call-mic"
          label={micOn ? 'Mute mic' : 'Unmute mic'}
          active={false}
          off={!micOn}
          onClick={toggleMic} data-id="toggle-mic"
        >
          {micOn ? <Mic size={21} /> : <MicOff size={21} />}
        </CtrlButton>
        <CtrlButton
          dataId="call-camera"
          label={camOn ? 'Stop camera' : 'Start camera'}
          active={false}
          off={!camOn}
          onClick={toggleCam} data-id="toggle-cam"
        >
          {camOn ? <Video size={21} /> : <VideoOff size={21} />}
        </CtrlButton>
        {onToggleTranscript ? (
          <CtrlButton
            dataId="call-captions"
            label="Toggle transcript"
            active={!transcriptCollapsed}
            off={false}
            onClick={onToggleTranscript} data-id="toggle-transcript"
          >
            <Captions size={21} />
          </CtrlButton>
        ) : null}
        <span style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.14)' }} />
        {onAddPerson ? (
          <CtrlButton dataId="call-add-person" label="Add person" active={false} off={false} onClick={onAddPerson} data-id="add-person">
            <UserPlus size={21} />
          </CtrlButton>
        ) : null}
        <CtrlButton dataId="call-add-bot" label="Add ugly-bot" active={false} off={false} dashed onClick={() => { addBot(); }} data-id="add-ugly-bot">
          <BotIcon size={21} />
        </CtrlButton>
        <span style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.14)' }} />
        <button
          type="button"
          data-id="call-end"
          onClick={() => void leave()}
          aria-label="End call"
          title="End call"
          style={{
            height: 46,
            padding: '0 22px',
            display: 'grid',
            placeItems: 'center',
            border: 'none',
            background: C.brandGrad,
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          <PhoneOff size={20} />
        </button>
      </div>
    </div>
  );
});

// Square dark control button (mock .cbig).
function CtrlButton({
  children,
  onClick,
  label,
  dataId,
  active,
  off,
  dashed = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  dataId: string;
  active: boolean;
  off: boolean;
  dashed?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      data-id={dataId}
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: 46,
        height: 46,
        display: 'grid',
        placeItems: 'center',
        border: active
          ? '1px solid #ff5500'
          : dashed
            ? '1px dashed #ff5500'
            : '1px solid rgba(255,255,255,0.14)',
        background: active ? 'rgba(255,85,0,0.30)' : 'rgba(255,255,255,0.05)',
        color: active || dashed ? '#ff5500' : off ? 'rgba(255,255,255,0.4)' : '#fff',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

// Neutral peer placeholder (no media yet) — dark silhouette like the mock.
function PeerPlaceholder({ name }: { name: string }): React.ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'radial-gradient(circle at 50% 40%, #2f3b4a, #182230 60%, #0b1018 100%)',
      }}
    >
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'radial-gradient(circle at 45% 35%, rgba(255,255,255,0.16), rgba(255,255,255,0.02))',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'var(--app-font-heading, sans-serif)',
          fontWeight: 800,
          fontSize: 22,
          color: 'rgba(255,255,255,0.85)',
        }}
      >
        {initials(name)}
      </div>
    </div>
  );
}

// Remote peer tile — binds the pulled MediaStream to a <video>.
// Simple audio visualization shown over a peer's VIDEO tile while they "speak"
// a typed message (the rule's "no avatar → simple visualization to indicate
// audio"). A small equalizer bottom-center.
function SpeakingPulse(): React.ReactElement {
  return (
    <div
      data-id="speaking-pulse"
      style={{ position: 'absolute', left: '50%', bottom: 18, transform: 'translateX(-50%)', display: 'flex', alignItems: 'flex-end', gap: 3, height: 18, zIndex: 3 }}
    >
      <style>{`@keyframes uc-eq {0%,100%{height:4px}50%{height:16px}}`}</style>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          style={{ width: 3, background: '#ff5500', borderRadius: 1, height: 4, animation: `uc-eq 0.7s ease-in-out ${i * 0.12}s infinite` }}
        />
      ))}
    </div>
  );
}

function RemoteTile({ stream, speakerId }: { stream: MediaStream; speakerId?: string }): React.ReactElement {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  // Route remote audio to the lobby-chosen speaker (where supported).
  useEffect(() => {
    const el = ref.current;
    if (el?.setSinkId && speakerId) void el.setSinkId(speakerId).catch(() => undefined);
  }, [speakerId]);
  return <video ref={ref} autoPlay playsInline data-id="remote-video" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}
