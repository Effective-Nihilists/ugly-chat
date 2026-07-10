/**
 * IncomingCall — the ring overlay shown to a user who is NOT yet in the call
 * but whose conversation has an active call (someone is calling them). Accept →
 * opens the lobby → joins; Decline → dismisses locally (the caller sees them
 * never join). This is the in-app ring; the native shell adds a push + sound
 * when the app isn't focused (Phase 3).
 */
import React from 'react';
import { Phone, PhoneOff } from 'lucide-react';

export interface IncomingCallProps {
  callerName: string;
  callerAvatarUrl?: string | null;
  onAccept: () => void;
  onDecline: () => void;
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return '?';
  if (p.length === 1) return (p[0] ?? '?').slice(0, 2).toUpperCase();
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase();
}

export function IncomingCall({ callerName, callerAvatarUrl, onAccept, onDecline }: IncomingCallProps): React.ReactElement {
  return (
    <div
      data-id="incoming-call"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1001,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(4,5,8,0.88)',
        backdropFilter: 'blur(8px)',
        color: '#fff',
      }}
    >
      <style>{`@keyframes uc-ring-pulse {0%{box-shadow:0 0 0 0 rgba(255,85,0,0.45)}70%{box-shadow:0 0 0 22px rgba(255,85,0,0)}100%{box-shadow:0 0 0 0 rgba(255,85,0,0)}}`}</style>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, padding: 28 }}>
        <div
          style={{
            width: 116,
            height: 116,
            borderRadius: '50%',
            overflow: 'hidden',
            display: 'grid',
            placeItems: 'center',
            background: 'linear-gradient(135deg, #ff8a4d 0%, #ff5500 50%, #d2470f 100%)',
            animation: 'uc-ring-pulse 1.4s ease-out infinite',
            fontFamily: 'var(--app-font-heading, sans-serif)',
            fontWeight: 800,
            fontSize: 40,
          }}
        >
          {callerAvatarUrl ? (
            <img src={callerAvatarUrl} alt={callerName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            initials(callerName)
          )}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--app-font-heading, sans-serif)', fontWeight: 800, fontSize: 22 }}>{callerName}</div>
          <div style={{ fontFamily: 'var(--app-font-mono, monospace)', fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginTop: 4 }}>
            Incoming video call
          </div>
        </div>
        <div style={{ display: 'flex', gap: 40, marginTop: 6 }}>
          <RingButton color="#ef4444" label="Decline" onClick={onDecline} dataId="incoming-call-decline" data-id="decline">
            <PhoneOff size={26} />
          </RingButton>
          <RingButton color="#22c55e" label="Accept" onClick={onAccept} dataId="incoming-call-accept" data-id="accept">
            <Phone size={26} />
          </RingButton>
        </div>
      </div>
    </div>
  );
}

function RingButton({
  color,
  label,
  onClick,
  dataId,
  children,
}: {
  color: string;
  label: string;
  onClick: () => void;
  dataId: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <button
        type="button"
        data-id={dataId}
        onClick={onClick}
        aria-label={label}
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          border: 'none',
          background: color,
          color: '#fff',
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
        }}
      >
        {children}
      </button>
      <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{label}</span>
    </div>
  );
}
