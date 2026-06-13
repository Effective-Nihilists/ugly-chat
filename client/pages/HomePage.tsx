import React from 'react';
import { PageLayout, Text } from 'ugly-app/client';

const ORANGE = '#F0500A';

function Feature(props: { emoji: string; title: string; desc: string }): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        alignItems: 'flex-start',
        padding: '16px 18px',
        borderRadius: 16,
        background: 'rgba(240, 80, 10, 0.06)',
        border: '1px solid rgba(240, 80, 10, 0.16)',
      }}
    >
      <div style={{ fontSize: 28, lineHeight: 1 }}>{props.emoji}</div>
      <div>
        <Text weight="bold">{props.title}</Text>
        <Text style={{ display: 'block', marginTop: 3, opacity: 0.7, fontSize: 14 }}>
          {props.desc}
        </Text>
      </div>
    </div>
  );
}

// Home / landing page for Ugly Chat. The '' route in shared/pages.ts maps here.
export default function HomePage(): React.ReactElement {
  return (
    <PageLayout>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '52px 24px', textAlign: 'center' }}>
        <img
          src="/icon.png"
          alt="Ugly Chat"
          width={104}
          height={104}
          style={{ borderRadius: 24, boxShadow: '0 10px 34px rgba(240, 80, 10, 0.35)' }}
        />

        <Text weight="bold" style={{ display: 'block', marginTop: 22, fontSize: 44, letterSpacing: -1 }}>
          Ugly Chat
        </Text>
        <Text style={{ display: 'block', marginTop: 8, fontSize: 18, opacity: 0.7 }}>
          Text &amp; video chat with humans and bots.
        </Text>

        <a
          href="/chat"
          style={{
            display: 'inline-block',
            marginTop: 28,
            padding: '14px 30px',
            borderRadius: 999,
            background: ORANGE,
            color: '#fff',
            fontWeight: 700,
            fontSize: 17,
            textDecoration: 'none',
            boxShadow: '0 8px 24px rgba(240, 80, 10, 0.4)',
          }}
        >
          Open Chat →
        </a>

        <div style={{ display: 'grid', gap: 12, marginTop: 40, textAlign: 'left' }}>
          <Feature
            emoji="💬"
            title="Real-time messaging"
            desc="Group and 1:1 chat with live updates, reactions, and markdown."
          />
          <Feature
            emoji="📹"
            title="Video calls"
            desc="Hop on a call from any conversation — humans and bots welcome."
          />
          <Feature
            emoji="🤖"
            title="Built-in bots"
            desc="Chat with AI bots like Ugly Bot and Sage, right alongside real people."
          />
        </div>

        <Text style={{ display: 'block', marginTop: 40, fontSize: 13, opacity: 0.4 }}>
          ugly.chat · powered by ugly.bot
        </Text>
      </div>
    </PageLayout>
  );
}
