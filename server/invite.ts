// Invite email for unknown addresses. Per platform topology, child apps no
// longer use an ugly.bot email proxy — transactional mail is sent by `to` via
// Cloudflare Email Sending (send.ugly.bot) using creds in `.env.publish`. The
// exact path is a deploy-time secret, so it's isolated behind injected env +
// fetch (same shape as resolveEmail.ts) and `buildInviteEmail` is pure.
import { shareLink } from 'ugly-app/server/adapter/workers';

export interface InviteMessage {
  to: string;
  subject: string;
  html: string;
}

/**
 * Pure: build the invite email body. `appUrl` is the deployed app origin (brand
 * label); `link` is the central short share link (https://ugly.bot/l/<code>)
 * that deep-links into the conversation.
 */
export function buildInviteEmail(
  to: string,
  inviterId: string,
  conversationId: string,
  appUrl: string,
  link: string,
): InviteMessage {
  const base = appUrl.replace(/\/+$/, '');
  return {
    to,
    subject: 'You have been invited to a chat on ugly.chat',
    html:
      `<p>You've been invited to chat on <a href="${base}">ugly.chat</a>.</p>` +
      `<p>Conversation: <code>${conversationId}</code></p>` +
      `<p><a href="${link}">Open the chat</a> — sign in with this email to join.</p>` +
      `<p style="color:#888;font-size:12px">Invited by ${inviterId}. ${link}</p>`,
  };
}

interface InviteEnv {
  EMAIL_SEND_URL?: string | undefined;
  EMAIL_SEND_TOKEN?: string | undefined;
  APP_URL?: string | undefined;
}

function readEnv(): InviteEnv {
  const env =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return {
    EMAIL_SEND_URL: env.EMAIL_SEND_URL,
    EMAIL_SEND_TOKEN: env.EMAIL_SEND_TOKEN,
    APP_URL: env.APP_URL,
  };
}

/**
 * Build + POST the invite email. `env`/`fetchFn` are injectable for tests;
 * production reads `globalThis.process.env`. Best-effort: callers catch.
 */
export async function sendInviteEmail(
  to: string,
  inviterId: string,
  conversationId = '',
  env: InviteEnv = readEnv(),
  fetchFn: typeof fetch = fetch,
  shareLinkFn: typeof shareLink = shareLink,
): Promise<void> {
  const sendUrl = env.EMAIL_SEND_URL ?? 'https://send.ugly.bot';
  const token = env.EMAIL_SEND_TOKEN;
  const appUrl = env.APP_URL ?? 'https://ugly.chat';
  const base = appUrl.replace(/\/+$/, '');
  const target = conversationId
    ? `${base}/#/chat/${encodeURIComponent(conversationId)}`
    : `${base}/`;
  // Central short link → deep-links into the chat; requireAuth so the recipient
  // signs in with this email before joining.
  const link = await shareLinkFn({
    target,
    og: { title: 'You have been invited to chat on ugly.chat' },
    requireAuth: true,
  });
  const msg = buildInviteEmail(to, inviterId, conversationId, appUrl, link);
  if (!token) {
    console.warn('[invite] EMAIL_SEND_TOKEN not set — skipping invite to', to);
    return;
  }
  const res = await fetchFn(sendUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(msg),
  });
  if (!res.ok) throw new Error(`invite send HTTP ${res.status}`);
}
