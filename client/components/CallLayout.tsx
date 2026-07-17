/**
 * CallLayout — orchestrates the call experience around the immersive VideoCall
 * stage: the pre-call device lobby, the incoming-call ring, the live transcript,
 * and the desktop/mobile layout chrome.
 *
 * Control model (the fix for "stuck in call after leaving"): the LOCAL user's
 * own participation drives the view, NOT the shared `conversation.call.active`.
 *   - `joined` (reported by VideoCall) → show the full call layout + hide the
 *     thread (`onActiveChange`). Leaving flips it false immediately, even if a
 *     human peer or a never-leaving bot keeps `call.active` true.
 *   - call active + I'm NOT a participant + not joined → show the incoming-call
 *     ring (Accept → lobby → join; Decline → dismiss this call instance).
 *   - the video button (ChatPage → ref.start()) opens the lobby (device pick +
 *     permission) before joining — for human AND bot calls.
 *
 * VideoCall stays mounted at all times (returns null until joined) so its
 * `start()`/`leave()` ref + roster subscription persist.
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { DBObject } from 'ugly-app/shared';
import { VideoCall, type VideoCallHandle, type CallProfiles } from './VideoCall';
import { TranscriptPanel, type SpeakerProfiles } from './TranscriptPanel';
import { SubtitleOverlay } from './SubtitleOverlay';
import { CallLobby } from './call/CallLobby';
import { IncomingCall } from './call/IncomingCall';
import type { DevicePrefs } from './call/useAvDevices';
import { useCallTranscript } from '../lib/useCallTranscript';
import type { useApp } from 'ugly-app/client';
import type { UglyBotSocket } from 'ugly-app/client';

type AppSocketT = ReturnType<typeof useApp>['socket'];

// Mirrors AppShell's SIDEBAR_MIN_WIDTH breakpoint.
const SIDEBAR_MIN_WIDTH = 820;

interface CallParticipant {
  userId: string;
  isBot: boolean;
  joinedAt: number;
}
interface CallStateDoc {
  active?: boolean;
  startedAt?: number;
  participants?: Record<string, CallParticipant>;
}
interface CallConvDoc extends DBObject {
  call?: CallStateDoc;
}

export interface CallLayoutProps {
  conversationId: string;
  meId: string;
  socket: AppSocketT;
  uglyBotSocket: UglyBotSocket | null;
  profiles: SpeakerProfiles;
  botModel?: string | null;
  autoJoinBotId?: string | null;
  /** Notifies the host (ChatPage) so it can hide the thread + composer. */
  onActiveChange?: (active: boolean) => void;
}

export const CallLayout = forwardRef<VideoCallHandle, CallLayoutProps>(function CallLayout(
  { conversationId, meId, socket, uglyBotSocket, profiles, botModel = null, autoJoinBotId = null, onActiveChange },
  ref,
) {
  const videoRef = useRef<VideoCallHandle>(null);
  const [call, setCall] = useState<CallStateDoc>({ active: false, participants: {} });
  const [joined, setJoined] = useState(false);
  const [lobbyOpen, setLobbyOpen] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  // call.startedAt we've actively declined, so the ring doesn't re-appear for it.
  // MUST be state, not a ref: nothing else re-renders while a ring is showing
  // (the roster poll only runs once joined), so mutating a ref left the overlay
  // on screen forever — Decline did nothing and its full-screen overlay swallowed
  // every click, bricking the conversation.
  const [declinedAt, setDeclinedAt] = useState<number>(-1);

  const [wide, setWide] = useState(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= SIDEBAR_MIN_WIDTH,
  );
  const [collapsed, setCollapsed] = useState(false); // desktop: hide panel → overlay
  const [expanded, setExpanded] = useState(false); // mobile: grow chat below video

  // Track the full call state off the conversation doc (roster + startedAt).
  useEffect(() => {
    const unsub = socket.trackDoc<CallConvDoc>('conversation', conversationId, (doc) => {
      setCall(doc?.call ?? { active: false, participants: {} });
    });
    return () => {
      unsub();
    };
  }, [socket, conversationId]);

  // The video button (ChatPage) opens the lobby; leave() tears down via VideoCall.
  useImperativeHandle(
    ref,
    () => ({
      start: () => {
        setCallError(null);
        setLobbyOpen(true);
      },
      leave: () => videoRef.current?.leave(),
    }),
    [],
  );

  // LOCAL participation drives the host's thread visibility (not call.active).
  useEffect(() => {
    onActiveChange?.(joined);
  }, [joined, onActiveChange]);

  useEffect(() => {
    const onResize = (): void => {
      setWide(window.innerWidth >= SIDEBAR_MIN_WIDTH);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  const participants = call.participants ?? {};
  const meParticipant = !!participants[meId];
  // Someone is calling us: call active, we're not in it, not joined, not in the
  // lobby, and we haven't declined this exact call instance.
  const incoming =
    !!call.active && !meParticipant && !joined && !lobbyOpen && (call.startedAt ?? 0) !== declinedAt;

  // Caller = the (first, human) participant that isn't us — for the ring/lobby.
  const callerId = Object.values(participants)
    .filter((p) => p.userId !== meId)
    .sort((a, b) => a.joinedAt - b.joinedAt)[0]?.userId;
  const callerName = callerId ? profiles[callerId]?.name ?? callerId.slice(0, 8) : 'Someone';
  const callerAvatar = callerId ? profiles[callerId]?.avatarUrl ?? null : null;

  const { turns, appendTyped, upsertExternalTurn } = useCallTranscript(
    socket,
    uglyBotSocket,
    conversationId,
    meId,
    joined,
  );

  const callProfiles: CallProfiles = profiles;

  // The always-mounted VideoCall stage (null until joined) + its ref/callbacks.
  const stage = (
    showSubs: boolean,
    subBottom: number,
    onToggle: (() => void) | undefined,
    transcriptCollapsed: boolean,
  ): React.ReactElement => (
    <VideoCall
      ref={videoRef}
      conversationId={conversationId}
      uglyBotSocket={uglyBotSocket}
      profiles={callProfiles}
      botModel={botModel}
      autoJoinBotId={autoJoinBotId}
      transcriptCollapsed={transcriptCollapsed}
      onJoinedChange={setJoined}
      onCallError={(m) => {
        setCallError(m);
        setLobbyOpen(false);
      }}
      {...(onToggle ? { onToggleTranscript: onToggle } : {})}
      subtitleSlot={
        showSubs ? <SubtitleOverlay turns={turns} meId={meId} profiles={profiles} bottom={subBottom} /> : null
      }
      onBotTurn={(botId, text, final) => {
        upsertExternalTurn(botId, text, final);
      }}
    />
  );

  // Overlays (lobby / ring / error) rendered above whatever layout is active.
  const overlays = (
    <>
      {lobbyOpen ? (
        <CallLobby
          {...(callerName !== 'Someone' ? { peerName: callerName } : {})}
          onJoin={(prefs: DevicePrefs) => {
            setLobbyOpen(false);
            videoRef.current?.start(prefs);
          }}
          onCancel={() => { setLobbyOpen(false); }}
        />
      ) : null}
      {incoming ? (
        <IncomingCall
          callerName={callerName}
          callerAvatarUrl={callerAvatar}
          onAccept={() => {
            setCallError(null);
            setLobbyOpen(true);
          }}
          onDecline={() => {
            setDeclinedAt(call.startedAt ?? 0);
          }}
        />
      ) : null}
      {callError ? (
        <div
          role="alert"
          onClick={() => { setCallError(null); }}
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 24,
            transform: 'translateX(-50%)',
            zIndex: 1002,
            maxWidth: 'min(420px, 90vw)',
            padding: '10px 14px',
            background: '#1a1c22',
            color: '#fff',
            border: '1px solid rgba(248,113,113,0.6)',
            fontSize: 13,
            cursor: 'pointer',
          }} data-id="div"
        >
          {callError}
        </div>
      ) : null}
    </>
  );

  // ── Single stable layout ──────────────────────────────────────────────────
  // CRITICAL: VideoCall must occupy the SAME tree slot whether or not we've
  // joined. Relocating it (the old bare-stage ↔ wrapped-layout switch) remounts
  // it → resets `joined` → tears down the live RTCPeerConnection mid-call (the
  // bug behind "joined but no video"). So we keep one stage slot always mounted
  // and only (a) collapse the container to zero height when not joined and
  // (b) mount/unmount the transcript chrome as a sibling.
  const showSubs = wide ? collapsed : !expanded;
  const subBottom = wide ? 96 : 124;
  const onToggle = wide ? () => { setCollapsed((v) => !v); } : () => { setExpanded((v) => !v); };
  const transcriptCollapsed = wide ? collapsed : expanded;
  const showTranscript = joined && (wide ? !collapsed : expanded);

  return (
    <>
      <div
        style={{
          flex: joined ? 1 : '0 0 0px',
          height: joined ? undefined : 0,
          minHeight: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: wide ? 'row' : 'column',
          background: 'var(--app-main)',
        }}
      >
        {/* STABLE stage slot — VideoCall lives here for its whole lifetime. */}
        <div
          style={{
            position: 'relative',
            flex: !wide && expanded ? 'none' : 1,
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            ...(!wide && expanded ? { height: 296 } : {}),
          }}
        >
          {stage(showSubs, subBottom, onToggle, transcriptCollapsed)}
          {!wide && joined && !expanded ? (
            <div className="uc-mcompose" style={{ position: 'absolute', left: 16, right: 16, bottom: 78, zIndex: 4 }}>
              <MobileCompose onSend={appendTyped} />
            </div>
          ) : null}
        </div>
        {/* Transcript chrome — sibling; mounting it never moves the stage slot. */}
        {showTranscript ? (
          wide ? (
            <TranscriptPanel
              turns={turns}
              meId={meId}
              profiles={profiles}
              onSend={appendTyped}
              onCollapse={() => { setCollapsed(true); }}
            />
          ) : (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
              <button
                type="button"
                data-id="call-collapse-chat"
                onClick={() => { setExpanded(false); }}
                aria-label="Collapse chat"
                title="Collapse chat"
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 8,
                  zIndex: 5,
                  width: 28,
                  height: 28,
                  display: 'grid',
                  placeItems: 'center',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--app-foreground-muted)',
                  cursor: 'pointer',
                }}
              >
                <ChevronDown size={18} />
              </button>
              <TranscriptPanel turns={turns} meId={meId} profiles={profiles} onSend={appendTyped} fill />
            </div>
          )
        ) : null}
      </div>
      {overlays}
    </>
  );
});

// Slim mobile compose input (light-on-dark, lives inside .uc-mcompose).
function MobileCompose({ onSend }: { onSend: (text: string) => void }): React.ReactElement {
  const [draft, setDraft] = useState('');
  const submit = (): void => {
    const t = draft.trim();
    if (!t) return;
    onSend(t);
    setDraft('');
  };
  return (
    <input
      data-id="call-mobile-input"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      }}
      placeholder="Type during the call…"
      aria-label="Type a message during the call"
    />
  );
}
