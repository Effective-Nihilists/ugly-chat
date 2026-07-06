/**
 * CallLobby — the pre-call permission + device-selection screen (ported in
 * spirit from the monolith's lobby state machine + DeviceSelector + MediaPreview).
 *
 * Shown before a user joins a call (caller: clicks the video button; callee:
 * accepts the incoming-call ring). It requests camera/mic permission, shows a
 * live local preview + mic level, lets the user pick webcam/mic/speaker, and on
 * "Join" hands the chosen device ids up so the call acquires media with them.
 *
 * The call (`VideoCall.join`) re-acquires its own stream from the chosen ids —
 * permission is already granted here, so there's no second prompt.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Mic, Video as VideoIcon, X } from 'lucide-react';
import { useAvDevices, type DevicePrefs } from './useAvDevices';

export interface CallLobbyProps {
  /** Name of who you're calling / who's calling, for the header. */
  peerName?: string;
  title?: string;
  onJoin: (prefs: DevicePrefs) => void;
  onCancel: () => void;
}

const LABEL = '#fff';
const DIM = 'rgba(255,255,255,0.55)';
const LINE = 'rgba(255,255,255,0.16)';

export function CallLobby({ peerName, title, onJoin, onCancel }: CallLobbyProps): React.ReactElement {
  const av = useAvDevices();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [level, setLevel] = useState(0); // 0..1 mic level

  // Kick off the permission prompt once on mount.
  useEffect(() => {
    void av.request();
    // run once — request is stable enough for the lobby's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Re)acquire the local preview whenever permission lands or the chosen
  // camera/mic changes. Tears down the previous stream + audio graph first.
  useEffect(() => {
    if (av.permission !== 'granted') return undefined;
    const state = { cancelled: false };
    let audioCtx: AudioContext | null = null;
    let raf = 0;

    const stop = (): void => {
      streamRef.current?.getTracks().forEach((t) => { t.stop(); });
      streamRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      if (audioCtx) void audioCtx.close().catch(() => undefined);
    };

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: av.selected.cameraId ? { deviceId: { exact: av.selected.cameraId } } : true,
          audio: av.selected.micId ? { deviceId: { exact: av.selected.micId } } : true,
        });
        if (state.cancelled) {
          stream.getTracks().forEach((t) => { t.stop(); });
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        // Mic level meter.
        audioCtx = new AudioContext();
        const src = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = (): void => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(1, peak / 96));
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // Surface via the hook's error on next request(); preview just stays blank.
      }
    })();

    return () => {
      state.cancelled = true;
      stop();
    };
  }, [av.permission, av.selected.cameraId, av.selected.micId]);

  const handleJoin = (): void => {
    streamRef.current?.getTracks().forEach((t) => { t.stop(); });
    streamRef.current = null;
    onJoin(av.selected);
  };
  const handleCancel = (): void => {
    streamRef.current?.getTracks().forEach((t) => { t.stop(); });
    streamRef.current = null;
    onCancel();
  };

  return (
    <div
      data-id="call-lobby"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(4,5,8,0.82)',
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          width: 'min(440px, 92vw)',
          background: '#0b0d12',
          border: `1px solid ${LINE}`,
          color: LABEL,
          padding: 18,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'var(--app-font-heading, sans-serif)', fontWeight: 800, fontSize: 16 }}>
            {title ?? (peerName ? `Call ${peerName}` : 'Start video call')}
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Cancel"
            style={{ border: 'none', background: 'transparent', color: DIM, cursor: 'pointer', display: 'grid', placeItems: 'center' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Preview */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '4 / 3',
            background: 'linear-gradient(135deg, #20232b, #101218)',
            border: `1px solid ${LINE}`,
            overflow: 'hidden',
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
          />
          {av.permission !== 'granted' ? (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: DIM, fontSize: 13, padding: 16, textAlign: 'center' }}>
              {av.permission === 'requesting' ? 'Requesting camera & mic…' : 'Camera preview appears here'}
            </div>
          ) : null}
          {/* Mic level bar */}
          {av.permission === 'granted' ? (
            <div style={{ position: 'absolute', left: 10, right: 10, bottom: 10, height: 4, background: 'rgba(255,255,255,0.15)' }}>
              <div style={{ height: '100%', width: `${Math.round(level * 100)}%`, background: '#ff5500', transition: 'width 80ms linear' }} />
            </div>
          ) : null}
        </div>

        {/* Permission-denied help */}
        {av.permission === 'denied' && av.error ? (
          <div style={{ border: `1px solid rgba(248,113,113,0.5)`, background: 'rgba(248,113,113,0.08)', padding: 12, fontSize: 12.5, lineHeight: 1.45 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{av.error.title}</div>
            <div style={{ color: DIM }}>{av.error.help}</div>
          </div>
        ) : null}

        {/* Device pickers (shown once we have labels) */}
        {av.permission === 'granted' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <DevicePicker icon={<VideoIcon size={14} />} label="Camera" value={av.selected.cameraId} options={av.cameras} onChange={av.setCamera} />
            <DevicePicker icon={<Mic size={14} />} label="Microphone" value={av.selected.micId} options={av.mics} onChange={av.setMic} />
            {av.speakers.length > 0 ? (
              <DevicePicker icon={<span style={{ fontSize: 12 }}>🔊</span>} label="Speaker" value={av.selected.speakerId} options={av.speakers} onChange={av.setSpeaker} />
            ) : null}
          </div>
        ) : null}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={handleCancel} style={btn(false)}>
            Cancel
          </button>
          {av.permission === 'denied' ? (
            <button type="button" onClick={() => void av.request()} style={btn(true)}>
              Retry
            </button>
          ) : (
            <button type="button" data-id="call-lobby-join" onClick={handleJoin} disabled={av.permission !== 'granted'} style={btn(true, av.permission !== 'granted')}>
              Join
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DevicePicker({
  icon,
  label,
  value,
  options,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | undefined;
  options: { id: string; label: string }[];
  onChange: (id: string) => void;
}): React.ReactElement {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: DIM, width: 92, flexShrink: 0 }}>
        {icon}
        {label}
      </span>
      <select
        value={value ?? ''}
        onChange={(e) => { onChange(e.target.value); }}
        style={{
          flex: 1,
          minWidth: 0,
          background: '#14161b',
          color: LABEL,
          border: `1px solid ${LINE}`,
          borderRadius: 0,
          padding: '6px 8px',
          fontSize: 12.5,
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function btn(primary: boolean, disabled = false): React.CSSProperties {
  return {
    padding: '8px 18px',
    borderRadius: 0,
    border: primary ? 'none' : `1px solid ${LINE}`,
    background: primary ? '#ff5500' : 'transparent',
    color: primary ? '#fff' : LABEL,
    fontWeight: 700,
    fontSize: 13,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}
