import React, { useCallback } from 'react';
import { Plus, Bot, Palette, MessageSquare } from 'lucide-react';
import { useApp } from 'ugly-app/client';
import { useRouter } from '../router';
import { useConversations } from '../lib/conversations';
import { openNewChatPopup } from '../components/NewChatPopup';
import { openBotsPopup } from '../components/BotsPopup';
import { openThemeMenu } from '../components/ThemeMenu';

// Chat-home main pane (the column beside the sidebar; on mobile it's the whole
// view). With no thread selected we show the mock's empty hero: a faint grid
// backdrop, a big display headline, a muted subtitle, one orange CTA, and a
// mono receipt line. A top-right icon cluster (Bots · Theme · Feedback) mirrors
// the sidebar header for mobile, where the sidebar is hidden.
export default function ChatHomePage(): React.ReactElement {
  const router = useRouter();
  const { socket, userId } = useApp();
  const { conversations } = useConversations();

  const navigate = useCallback(
    (conversationId: string) => router.push('chat/:conversationId', { conversationId }),
    [router],
  );

  const openNew = useCallback(() => {
    const recent = conversations.filter((c) => c.type !== 'group').slice(0, 8);
    openNewChatPopup(router, socket, recent, navigate);
  }, [router, socket, conversations, navigate]);

  const openBots = useCallback(() => {
    openBotsPopup(router, socket, userId, (botId) => router.push('bot/:botId', { botId }), navigate);
  }, [router, socket, userId, navigate]);

  const openTheme = useCallback(() => openThemeMenu(router), [router]);
  const openFeedback = useCallback(() => {
    document.querySelector<HTMLElement>('[data-id="feedback-button"]')?.click();
  }, []);

  return (
    <div
      style={{
        position: 'relative',
        display: 'grid',
        placeItems: 'center',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--app-main)',
      }}
    >
      {/* Top-right icon cluster (mobile-facing — desktop has it in the sidebar) */}
      <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', alignItems: 'center', gap: 2, zIndex: 1 }}>
        <button type="button" title="Bots" onClick={openBots} className="uc-iconbtn" style={topIconBtn}>
          <Bot size={18} />
        </button>
        <button type="button" title="Theme" onClick={openTheme} className="uc-iconbtn" style={topIconBtn}>
          <Palette size={18} />
        </button>
        <button type="button" title="Feedback" onClick={openFeedback} className="uc-iconbtn" style={topIconBtn}>
          <MessageSquare size={18} />
        </button>
      </div>

      {/* Faint 64px grid, radial-masked toward the top-center. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(var(--app-border) 1px, transparent 1px), linear-gradient(90deg, var(--app-border) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          WebkitMaskImage: 'radial-gradient(circle at 50% 30%, #000 0%, transparent 75%)',
          maskImage: 'radial-gradient(circle at 50% 30%, #000 0%, transparent 75%)',
          opacity: 0.5,
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative', textAlign: 'center', maxWidth: 440, padding: 30 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--app-font-heading)',
            fontWeight: 800,
            fontSize: 44,
            lineHeight: 0.96,
            letterSpacing: '-0.04em',
            color: 'var(--app-foreground)',
          }}
        >
          Pick a thread.
          <br />
          <span style={{ color: 'var(--app-foreground-muted)' }}>Or start one.</span>
        </h1>

        <p
          style={{
            margin: '18px auto 26px',
            maxWidth: 360,
            fontSize: 15,
            lineHeight: 1.55,
            color: 'var(--app-foreground-muted)',
          }}
        >
          We won&apos;t autocomplete your feelings, invent a friend who isn&apos;t there, or tell you the message sent
          when it didn&apos;t.
        </p>

        <button
          type="button"
          onClick={openNew}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '13px 22px',
            border: 'none',
            cursor: 'pointer',
            background: 'var(--app-primary)',
            color: 'var(--app-on-primary)',
            fontFamily: 'var(--app-font-heading)',
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          <Plus size={16} />
          New conversation
        </button>

        <div
          style={{
            marginTop: 26,
            fontFamily: 'var(--app-font-mono)',
            fontSize: 10.5,
            letterSpacing: '0.02em',
            color: 'var(--app-foreground-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 7,
            whiteSpace: 'nowrap',
          }}
        >
          <span>open models</span>
          <span style={{ color: 'var(--app-border)' }}>·</span>
          <span style={{ color: 'var(--app-primary)' }}>$0.00/mo</span>
        </div>
      </div>
    </div>
  );
}

const topIconBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  flexShrink: 0,
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: 'var(--app-foreground-muted)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
