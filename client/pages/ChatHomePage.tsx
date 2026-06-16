import React from 'react';
import { Plus } from 'lucide-react';
import { useRouter } from '../router';

// Chat-home main pane (the column beside the sidebar). With no thread selected
// we show the mock's empty hero: a faint grid backdrop, a big display headline,
// a muted subtitle, one orange CTA, and a mono receipt line.
export default function ChatHomePage(): React.ReactElement {
  const router = useRouter();
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
          onClick={() => router.push('new', {})}
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
          <span>e2e encrypted</span>
          <span style={{ color: 'var(--app-border)' }}>·</span>
          <span>cloudflare</span>
          <span style={{ color: 'var(--app-border)' }}>·</span>
          <span style={{ color: 'var(--app-primary)' }}>$0.00/mo</span>
        </div>
      </div>
    </div>
  );
}
