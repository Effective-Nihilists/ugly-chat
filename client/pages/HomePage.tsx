import React, { useEffect, useState } from 'react';
import { startUglyBotLogin, hasSessionCookie } from 'ugly-app/client';
import {
  MessagesSquare,
  Users,
  Bot,
  Video,
  Smile,
  Paperclip,
  Zap,
  ArrowRight,
  Send,
} from 'lucide-react';

// "Open chat" CTAs: if a session already exists, go straight to the app;
// otherwise open the ugly.bot login directly from this click (a user gesture,
// so the popup isn't blocked) and land in chat once signed in. No intermediate
// "page with just a login button".
function openChat(e?: React.MouseEvent): void {
  e?.preventDefault();
  if (hasSessionCookie()) {
    window.location.href = '/chat';
    return;
  }
  startUglyBotLogin({ redirectTo: '/chat' });
}

// ── Brand tokens (fixed dark marketing palette; matches ugly.bot's landing) ──
const BRAND = '#FF5500';
const BRAND_GRAD = 'linear-gradient(135deg, #FF8041 0%, #FF5500 50%, #E63900 100%)';
const BG = '#0b0b0d';
const ELEV = '#141417';
const BORDER = 'rgba(255,255,255,0.10)';
const TEXT = '#ffffff';
const MUTED = 'rgba(255,255,255,0.62)';
const FAINT = 'rgba(255,255,255,0.40)';
const FONT_DISPLAY = "var(--app-font-heading), 'Plus Jakarta Sans', sans-serif";
const FONT_BODY = "var(--app-font-body), 'Inter', sans-serif";
const FONT_MONO = "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace";

function useDesktop(): boolean {
  const [d, setD] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 900));
  useEffect(() => {
    const f = (): void => setD(window.innerWidth >= 900);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return d;
}

// ── Home / landing page. The '' route (auth:false) in shared/pages.ts maps here.
export default function HomePage(): React.ReactElement {
  const desktop = useDesktop();
  // Already signed in (e.g. arrived here via the ugly.bot SSO redirect)? Skip
  // the marketing landing and go straight to the app.
  useEffect(() => {
    if (hasSessionCookie()) window.location.replace('/chat');
  }, []);
  return (
    <div
      style={{
        minHeight: '100dvh',
        width: '100%',
        background: BG,
        color: TEXT,
        fontFamily: FONT_BODY,
        overflowX: 'hidden',
        boxSizing: 'border-box',
        // Respect the notch / home-indicator on mobile (the dark bg still fills
        // behind them since the padding is inside this full-bleed container).
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <StyleOnce />
      <Nav />
      <Hero desktop={desktop} />
      <Features desktop={desktop} />
      <Manifesto desktop={desktop} />
      <Footer />
    </div>
  );
}

// ── Top nav ──────────────────────────────────────────────────────────────────
function Nav(): React.ReactElement {
  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/icon.png" width={30} height={30} alt="" style={{ borderRadius: 8 }} />
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 19, letterSpacing: -0.3 }}>
          ugly<span style={{ color: BRAND }}>.</span>chat
        </span>
      </div>
      <a href="/chat" onClick={openChat} className="lp-cta-ghost" style={ghostCta}>
        Open chat
      </a>
    </div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────
function Hero({ desktop }: { desktop: boolean }): React.ReactElement {
  return (
    <section style={{ position: 'relative', maxWidth: 1180, margin: '0 auto', padding: desktop ? '64px 24px 40px' : '36px 24px 24px' }}>
      {/* radial glow */}
      <div style={{ position: 'absolute', top: -120, left: '50%', transform: 'translateX(-50%)', width: 720, height: 420, background: 'rgba(255,85,0,0.16)', filter: 'blur(120px)', borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: desktop ? '1.05fr 0.95fr' : '1fr', gap: desktop ? 48 : 32, alignItems: 'center' }}>
        <div>
          <div style={eyebrow}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: BRAND, display: 'inline-block' }} className="lp-pulse" />
            Real-time chat · humans &amp; bots
          </div>
          <h1 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: desktop ? 'clamp(52px, 6.5vw, 84px)' : 44, lineHeight: 0.98, letterSpacing: -2, margin: '18px 0 0' }}>
            Honest chat.<br />
            <span style={{ color: BRAND }}>Open</span> models.<br />
            Cents per turn.
          </h1>
          <p style={{ marginTop: 20, fontSize: desktop ? 19 : 16, lineHeight: 1.55, color: MUTED, maxWidth: 480 }}>
            Group and 1:1 conversations with friends and AI bots — live updates,
            reactions, markdown, files, and video calls. Built on ugly.bot, so the
            bots run cheap open models and tell you what each turn costs.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 30 }}>
            <a href="/chat" onClick={openChat} className="lp-cta" style={primaryCta}>
              Open chat <ArrowRight size={18} />
            </a>
            <a href="https://ugly.bot" className="lp-cta-ghost" style={{ ...ghostCta, padding: '13px 22px' }}>
              Powered by ugly.bot
            </a>
          </div>
        </div>
        <ChatPreview desktop={desktop} />
      </div>
    </section>
  );
}

// ── Mock chat preview card ───────────────────────────────────────────────────
function ChatPreview({ desktop }: { desktop: boolean }): React.ReactElement {
  return (
    <div style={{ border: `1px solid ${BORDER}`, background: ELEV, borderRadius: 16, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 16px', borderBottom: `1px solid ${BORDER}` }}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', background: BRAND_GRAD, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Bot size={15} color="#fff" />
        </span>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Ugly Bot</span>
        <span style={{ marginLeft: 'auto', fontFamily: FONT_MONO, fontSize: 11, color: FAINT }}>GLM-5.1 · open</span>
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Bubble who="you" text="what's a cheap weeknight dinner?" />
        <Bubble who="bot" text="Sheet-pan gnocchi: crisp the gnocchi, roast cherry tomatoes + white beans, toss with spinach. ~15 min, one pan." />
        <Bubble who="you" text="make it spicier?" />
        <Bubble who="bot" text="Add a spoon of chili crisp at the end and a pinch of red-pepper flakes while roasting." />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderTop: `1px solid ${BORDER}`, fontFamily: FONT_MONO, fontSize: 11, color: FAINT }}>
        <span style={{ color: BRAND }}>$0.0041</span>
        <span>·</span>
        <span>622 tokens</span>
        <span>·</span>
        <span>1.4s</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5, color: BRAND }}>
          <Send size={13} /> send
        </span>
      </div>
    </div>
  );
}

function Bubble({ who, text }: { who: 'you' | 'bot'; text: string }): React.ReactElement {
  const isYou = who === 'you';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isYou ? 'flex-end' : 'flex-start', gap: 3 }}>
      <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: FAINT, textTransform: 'uppercase', letterSpacing: 1 }}>{who}</span>
      <span
        style={{
          maxWidth: '86%',
          padding: '8px 12px',
          borderRadius: 12,
          fontSize: 13.5,
          lineHeight: 1.5,
          background: isYou ? BRAND : 'rgba(255,255,255,0.06)',
          color: isYou ? '#fff' : 'rgba(255,255,255,0.92)',
          border: isYou ? 'none' : `1px solid ${BORDER}`,
        }}
      >
        {text}
      </span>
    </div>
  );
}

// ── Features ─────────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: MessagesSquare, title: 'Real-time messaging', desc: 'Group and 1:1 threads with live updates, markdown, edits, and deletes — no refresh.' },
  { icon: Bot, title: 'Chat alongside AI', desc: 'Built-in bots like Ugly Bot answer right in the thread, on cheap open models with visible cost.' },
  { icon: Smile, title: 'Reactions', desc: 'Six one-tap reactions on every message. Lucide icons, never a wall of emoji.' },
  { icon: Video, title: 'Video calls', desc: 'Hop on a call from any conversation — humans and bots welcome.' },
  { icon: Paperclip, title: 'Files & images', desc: 'Drop in images and files. Images render inline; everything lands in your own storage.' },
  { icon: Users, title: 'Groups & DMs', desc: 'Spin up a group chat or message one-on-one. Avatars and history come from ugly.bot.' },
];

function Features({ desktop }: { desktop: boolean }): React.ReactElement {
  return (
    <section style={{ maxWidth: 1180, margin: '0 auto', padding: desktop ? '56px 24px' : '36px 24px' }}>
      <SectionLabel n="01" label="What's inside" />
      <h2 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: desktop ? 'clamp(30px, 4vw, 44px)' : 28, letterSpacing: -1, margin: '12px 0 28px', maxWidth: 640 }}>
        Everything you expect from chat — with bots that earn their keep.
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: desktop ? 'repeat(3, 1fr)' : '1fr', gap: 14 }}>
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.title} className="lp-feature" style={featureCard}>
              <span style={{ width: 40, height: 40, borderRadius: 11, border: `1px solid ${BORDER}`, background: 'rgba(255,85,0,0.10)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={20} color={BRAND} />
              </span>
              <div style={{ marginTop: 14, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17 }}>{f.title}</div>
              <div style={{ marginTop: 6, fontSize: 14, lineHeight: 1.55, color: MUTED }}>{f.desc}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Manifesto strip ──────────────────────────────────────────────────────────
function Manifesto({ desktop }: { desktop: boolean }): React.ReactElement {
  return (
    <section style={{ maxWidth: 1180, margin: '0 auto', padding: desktop ? '40px 24px 64px' : '24px 24px 40px' }}>
      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 18, background: ELEV, padding: desktop ? '40px 44px' : '28px 24px', display: 'grid', gridTemplateColumns: desktop ? '1fr auto' : '1fr', gap: 24, alignItems: 'center' }}>
        <div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FONT_MONO, fontSize: 12, letterSpacing: 1, color: BRAND, textTransform: 'uppercase' }}>
            <Zap size={14} /> One account · open models · cents per turn
          </div>
          <h3 style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: desktop ? 30 : 24, letterSpacing: -0.8, margin: '12px 0 0', maxWidth: 620 }}>
            No paywall in front of a real answer.
          </h3>
          <p style={{ marginTop: 10, fontSize: 15, lineHeight: 1.6, color: MUTED, maxWidth: 620 }}>
            Ugly Chat runs on ugly.bot — cheap-by-default model routing, honest receipts,
            built and maintained by one engineer. Your conversations, your storage, your bill.
          </p>
        </div>
        <a href="/chat" onClick={openChat} className="lp-cta" style={{ ...primaryCta, whiteSpace: 'nowrap' }}>
          Start chatting <ArrowRight size={18} />
        </a>
      </div>
    </section>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────────
function Footer(): React.ReactElement {
  return (
    <footer style={{ borderTop: `1px solid ${BORDER}`, marginTop: 8 }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '28px 24px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 16 }}>
          ugly<span style={{ color: BRAND }}>.</span>chat
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: FAINT }}>
          powered by ugly.bot · © 2026
        </span>
        <div style={{ display: 'flex', gap: 18, fontSize: 13 }}>
          <a href="/chat" onClick={openChat} className="lp-link" style={footLink}>Open chat</a>
          <a href="https://ugly.bot" className="lp-link" style={footLink}>ugly.bot</a>
        </div>
      </div>
    </footer>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────
function SectionLabel({ n, label }: { n: string; label: string }): React.ReactElement {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontFamily: FONT_MONO, fontSize: 12, letterSpacing: 1.5, color: FAINT, textTransform: 'uppercase' }}>
      <span style={{ color: BRAND }}>{n}</span>
      <span style={{ width: 24, height: 1, background: BORDER }} />
      {label}
    </div>
  );
}

const eyebrow: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 9,
  fontFamily: FONT_MONO, fontSize: 12, letterSpacing: 0.5, color: MUTED,
  textTransform: 'uppercase', border: `1px solid ${BORDER}`, borderRadius: 999, padding: '6px 12px',
};

const primaryCta: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '14px 26px', borderRadius: 999, background: BRAND, color: '#fff',
  fontWeight: 700, fontSize: 16, textDecoration: 'none',
};

const ghostCta: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8,
  padding: '9px 18px', borderRadius: 999, border: `1px solid ${BORDER}`,
  color: TEXT, fontWeight: 600, fontSize: 14, textDecoration: 'none', background: 'transparent',
};

const featureCard: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
  padding: 22, borderRadius: 16, border: `1px solid ${BORDER}`, background: ELEV,
};

const footLink: React.CSSProperties = { color: MUTED, textDecoration: 'none' };

// Injected once: hover/animation that inline styles can't express.
function StyleOnce(): React.ReactElement {
  return (
    <style>{`
      .lp-cta { transition: transform .14s ease, box-shadow .14s ease; }
      .lp-cta:hover { transform: translateY(-1px); box-shadow: 0 0 28px rgba(255,85,0,0.45); }
      .lp-cta-ghost { transition: border-color .14s ease, color .14s ease; }
      .lp-cta-ghost:hover { border-color: ${BRAND}; color: #fff; }
      .lp-feature { transition: border-color .14s ease, transform .14s ease; }
      .lp-feature:hover { border-color: ${BRAND}; transform: translateY(-2px); }
      .lp-link:hover { color: ${BRAND} !important; }
      .lp-pulse { animation: lp-pulse 1.8s ease-in-out infinite; }
      @keyframes lp-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
    `}</style>
  );
}
