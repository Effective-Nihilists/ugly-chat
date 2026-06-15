/**
 * Cloudflare Realtime (Calls) SFU + TURN broker.
 *
 * The SFU app secret + TURN key token live ONLY in the worker (provisioned at
 * publish into `REALTIME_*` secret bindings). The browser never sees them — it
 * talks WebRTC to the SFU but exchanges SDP/track metadata through these
 * server-brokered RPCs. Room membership + which tracks each peer published is
 * carried on `conversation.call` (trackDocs), so no separate signaling DO is
 * needed — see server/video.ts.
 *
 * Flow (per client):
 *   1. realtimeIceServers()                  → STUN/TURN for the RTCPeerConnection
 *   2. realtimeNewSession()                  → an SFU sessionId
 *   3. realtimeTracks(sessionId, {offer, local tracks})  → push: SDP answer + names
 *   4. videoPublish(...) (video.ts)          → advertise {sessionId, trackNames}
 *   5. on a peer appearing: realtimeTracks(mySession, {remote: peer tracks})
 *      → pull: SDP offer + requiresImmediateRenegotiation
 *   6. realtimeRenegotiate(mySession, {answer})          → finalize the pull
 */
const SFU_BASE = 'https://rtc.live.cloudflare.com/v1';

interface RealtimeCfg {
  appId: string;
  appSecret: string;
  turnKeyId: string;
  turnKeyToken: string;
}

function cfg(): RealtimeCfg | null {
  const env =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  const appId = env['REALTIME_APP_ID'];
  const appSecret = env['REALTIME_APP_SECRET'];
  if (!appId || !appSecret) return null;
  return {
    appId,
    appSecret,
    turnKeyId: env['REALTIME_TURN_KEY_ID'] ?? '',
    turnKeyToken: env['REALTIME_TURN_KEY_TOKEN'] ?? '',
  };
}

export function realtimeEnabled(): boolean {
  return cfg() !== null;
}

async function sfu(
  c: RealtimeCfg,
  path: string,
  method: 'POST' | 'PUT',
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${SFU_BASE}/apps/${c.appId}${path}`, {
    method,
    headers: { Authorization: `Bearer ${c.appSecret}`, 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`SFU ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 240)}`);
  }
  return json;
}

export async function realtimeNewSession(): Promise<{ sessionId: string }> {
  const c = cfg();
  if (!c) throw new Error('Realtime not configured');
  const j = (await sfu(c, '/sessions/new', 'POST')) as { sessionId?: string };
  if (!j.sessionId) throw new Error('SFU returned no sessionId');
  return { sessionId: j.sessionId };
}

/** Relay a tracks/new call (push local OR pull remote — the client builds the body). */
export async function realtimeTracks(sessionId: string, body: unknown): Promise<unknown> {
  const c = cfg();
  if (!c) throw new Error('Realtime not configured');
  return sfu(c, `/sessions/${encodeURIComponent(sessionId)}/tracks/new`, 'POST', body);
}

/** Finalize a pull renegotiation (client answers the SFU's offer). */
export async function realtimeRenegotiate(sessionId: string, body: unknown): Promise<unknown> {
  const c = cfg();
  if (!c) throw new Error('Realtime not configured');
  return sfu(c, `/sessions/${encodeURIComponent(sessionId)}/renegotiate`, 'PUT', body);
}

/** Short-lived STUN/TURN ICE servers minted from the TURN key (falls back to
 *  Cloudflare's public STUN when no TURN key is configured). */
export async function realtimeIceServers(): Promise<{ iceServers: unknown }> {
  const fallback = { iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] };
  const c = cfg();
  if (!c || !c.turnKeyId || !c.turnKeyToken) return fallback;
  try {
    const res = await fetch(
      `${SFU_BASE}/turn/keys/${encodeURIComponent(c.turnKeyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.turnKeyToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: 3600 }),
      },
    );
    if (!res.ok) return fallback;
    return (await res.json()) as { iceServers: unknown };
  } catch {
    return fallback;
  }
}
