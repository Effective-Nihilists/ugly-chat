import React, { useEffect, useState } from "react";
import { startUglyBotLogin, hasSessionCookie } from "ugly-app/client";
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
} from "lucide-react";
import {
  BG,
  BG_ELEV,
  BORDER,
  BORDER_STRONG,
  BRAND,
  BRAND_GRAD,
  FONT_BODY,
  FONT_DISPLAY,
  FONT_MONO,
  ON_BRAND,
  TEXT,
  TEXT_FAINT,
  TEXT_MUTED,
} from "../landing/landingBrandTokens";

// "Open chat" CTAs: if a session already exists, go straight to the app;
// otherwise open the ugly.bot login directly from this click (a user gesture,
// so the popup isn't blocked) and land in chat once signed in. No intermediate
// "page with just a login button".
function openChat(e?: React.MouseEvent): void {
  e?.preventDefault();
  if (hasSessionCookie()) {
    window.location.href = "/";
    return;
  }
  startUglyBotLogin({ redirectTo: "/" });
}

// ── Brand tokens ────────────────────────────────────────────────────────────
// Imported at the top of the file from ../landing/landingBrandTokens, shared
// with ugly.bot's landing page and theme-portable: every neutral derives from
// --app-background / --app-foreground, so this page follows the reader's theme
// (light, dark, cosmic-latte, vim) instead of insisting on the dark one it used
// to hardcode.
//
// These are this page's existing names for three of the tokens, so the markup
// below doesn't need a rename sweep.
const ELEV = BG_ELEV;
const MUTED = TEXT_MUTED;
const FAINT = TEXT_FAINT;

function useDesktop(): boolean {
  const [d, setD] = useState(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 900,
  );
  useEffect(() => {
    const f = (): void => {
      setD(window.innerWidth >= 900);
    };
    window.addEventListener("resize", f);
    return () => {
      window.removeEventListener("resize", f);
    };
  }, []);
  return d;
}

// ── Home / landing page. The '' route (auth:false) in shared/pages.ts maps here.
export default function HomePage(): React.ReactElement {
  const desktop = useDesktop();
  // Already signed in (e.g. arrived here via the ugly.bot SSO redirect)? Skip
  // the marketing landing and go straight to the app.
  useEffect(() => {
    if (hasSessionCookie()) window.location.replace("/");
  }, []);
  return (
    <div
      style={{
        minHeight: "100dvh",
        width: "100%",
        background: BG,
        color: TEXT,
        fontFamily: FONT_BODY,
        overflowX: "hidden",
        boxSizing: "border-box",
        // Respect the notch / home-indicator on mobile (the dark bg still fills
        // behind them since the padding is inside this full-bleed container).
        paddingTop: "var(--safe-area-inset-top, 0px)",
        paddingBottom: "var(--safe-area-inset-bottom, 0px)",
        paddingLeft: "var(--safe-area-inset-left, 0px)",
        paddingRight: "var(--safe-area-inset-right, 0px)",
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
    <div
      style={{
        maxWidth: 1240,
        margin: "0 auto",
        padding: "20px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <img
          src="/icon.png"
          width={30}
          height={30}
          alt=""
          style={{ borderRadius: 8 }}
        />
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 800,
            fontSize: 19,
            letterSpacing: -0.3,
          }}
        >
          ugly<span style={{ color: BRAND }}>.</span>chat
        </span>
      </div>
      <a
        href="/"
        onClick={openChat}
        className="lp-cta-ghost"
        style={ghostCta}
        data-id="open-chat"
      >
        Open chat
      </a>
    </div>
  );
}

// ── Hero ─────────────────────────────────────────────────────────────────────
function Hero({ desktop }: { desktop: boolean }): React.ReactElement {
  return (
    <section
      style={{
        position: "relative",
        maxWidth: 1240,
        margin: "0 auto",
        padding: desktop ? "64px 24px 40px" : "36px 24px 24px",
      }}
    >
      {/* radial glow */}
      <div
        style={{
          position: "absolute",
          top: -120,
          left: "50%",
          transform: "translateX(-50%)",
          width: 720,
          height: 420,
          background: "rgba(255,85,0,0.16)",
          filter: "blur(120px)",
          borderRadius: "50%",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "relative",
          display: "grid",
          gridTemplateColumns: desktop ? "1.05fr 0.95fr" : "1fr",
          gap: desktop ? 48 : 32,
          alignItems: "center",
        }}
      >
        <div>
          <div style={eyebrow}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: BRAND,
                display: "inline-block",
              }}
              className="lp-pulse"
            />
            Real-time chat · humans &amp; bots
          </div>
          <h1
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 800,
              fontSize: desktop ? "clamp(52px, 6.5vw, 84px)" : 44,
              lineHeight: 0.98,
              letterSpacing: -2,
              margin: "18px 0 0",
            }}
          >
            Honest chat.
            <br />
            <span style={{ color: BRAND }}>Open</span> models.
            <br />
            Cents per turn.
          </h1>
          <p
            style={{
              marginTop: 20,
              fontSize: desktop ? 19 : 16,
              lineHeight: 1.55,
              color: MUTED,
              maxWidth: 480,
            }}
          >
            Group and 1:1 conversations with friends and AI bots — live updates,
            reactions, markdown, files, and video calls. Built on ugly.bot, so
            the bots run cheap open models and tell you what each turn costs.
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 12,
              marginTop: 30,
            }}
          >
            <a
              href="/"
              onClick={openChat}
              className="lp-cta"
              style={primaryCta}
              data-id="open-chat-2"
            >
              Open chat <ArrowRight size={18} />
            </a>
            <a
              href="https://ugly.bot"
              className="lp-cta-ghost"
              style={{ ...ghostCta, padding: "13px 22px" }}
              data-id="powered-by-ugly-bot"
            >
              Powered by ugly.bot
            </a>
          </div>
        </div>
        <ChatPreview />
      </div>
    </section>
  );
}

// ── Mock chat preview card ───────────────────────────────────────────────────
function ChatPreview(): React.ReactElement {
  return (
    <div
      style={{
        border: `1px solid ${BORDER}`,
        background: ELEV,
        overflow: "hidden",
        // Softer than the old 0.5: that was tuned against a near-black page and
        // reads as a smudge on a light one.
        boxShadow: "0 30px 80px rgba(0,0,0,0.22)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "12px 16px",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <span
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: BRAND_GRAD,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Sits on the brand gradient, so it stays white in every theme. */}
          <Bot size={15} color={ON_BRAND} />
        </span>
        <span style={{ fontWeight: 700, fontSize: 14 }}>Ugly Bot</span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: FAINT,
          }}
        >
          GLM-5.1 · open
        </span>
      </div>
      <div
        style={{
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <Bubble who="you" text="what's a cheap weeknight dinner?" />
        <Bubble
          who="bot"
          text="Sheet-pan gnocchi: crisp the gnocchi, roast cherry tomatoes + white beans, toss with spinach. ~15 min, one pan."
        />
        <Bubble who="you" text="make it spicier?" />
        <Bubble
          who="bot"
          text="Add a spoon of chili crisp at the end and a pinch of red-pepper flakes while roasting."
        />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          borderTop: `1px solid ${BORDER}`,
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: FAINT,
        }}
      >
        <span style={{ color: BRAND }}>$0.0041</span>
        <span>·</span>
        <span>622 tokens</span>
        <span>·</span>
        <span>1.4s</span>
        <span
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            color: BRAND,
          }}
        >
          <Send size={13} /> send
        </span>
      </div>
    </div>
  );
}

function Bubble({
  who,
  text,
}: {
  who: "you" | "bot";
  text: string;
}): React.ReactElement {
  const isYou = who === "you";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isYou ? "flex-end" : "flex-start",
        gap: 3,
      }}
    >
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: FAINT,
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        {who}
      </span>
      <span
        style={{
          maxWidth: "86%",
          padding: "8px 12px",
          borderRadius: 12,
          fontSize: 13.5,
          lineHeight: 1.5,
          // Your own bubble is brand-filled (white text in every theme); the
          // other party's is a plain elevated surface that follows the theme.
          background: isYou ? BRAND : ELEV,
          color: isYou ? ON_BRAND : TEXT,
          border: isYou ? "none" : `1px solid ${BORDER}`,
        }}
      >
        {text}
      </span>
    </div>
  );
}

// ── Features ─────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: MessagesSquare,
    title: "Real-time messaging",
    desc: "Group and 1:1 threads with live updates, markdown, edits, and deletes — no refresh.",
  },
  {
    icon: Bot,
    title: "Chat alongside AI",
    desc: "Built-in bots like Ugly Bot answer right in the thread, on cheap open models with visible cost.",
  },
  {
    icon: Smile,
    title: "Reactions",
    desc: "Six one-tap reactions on every message. Lucide icons, never a wall of emoji.",
  },
  {
    icon: Video,
    title: "Video calls",
    desc: "Hop on a call from any conversation — humans and bots welcome.",
  },
  {
    icon: Paperclip,
    title: "Files & images",
    desc: "Drop in images and files. Images render inline; everything lands in your own storage.",
  },
  {
    icon: Users,
    title: "Groups & DMs",
    desc: "Spin up a group chat or message one-on-one. Avatars and history come from ugly.bot.",
  },
];

function Features({ desktop }: { desktop: boolean }): React.ReactElement {
  return (
    <section
      style={{
        maxWidth: 1240,
        margin: "0 auto",
        padding: desktop ? "56px 24px" : "36px 24px",
      }}
    >
      <SectionLabel n="01" label="What's inside" />
      <h2
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 800,
          fontSize: desktop ? "clamp(30px, 4vw, 44px)" : 28,
          // styles.css sets a FIXED `h2 { line-height: 32px }` for a 24px
          // heading. At 44px the lines collide. The kit's SectionHead sets 1;
          // match it.
          lineHeight: 1.05,
          letterSpacing: -1,
          margin: "12px 0 28px",
          maxWidth: 640,
        }}
      >
        Everything you expect from chat — with bots that earn their keep.
      </h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: desktop ? "repeat(3, 1fr)" : "1fr",
          gap: 14,
        }}
      >
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.title} className="lp-feature" style={featureCard}>
              <span
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 11,
                  border: `1px solid ${BORDER}`,
                  background: "rgba(255,85,0,0.10)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Icon size={20} color={BRAND} />
              </span>
              <div
                style={{
                  marginTop: 14,
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 700,
                  fontSize: 17,
                }}
              >
                {f.title}
              </div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: MUTED,
                }}
              >
                {f.desc}
              </div>
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
    <section
      style={{
        maxWidth: 1240,
        margin: "0 auto",
        padding: desktop ? "40px 24px 64px" : "24px 24px 40px",
      }}
    >
      <div
        style={{
          border: `1px solid ${BORDER}`,
          background: ELEV,
          padding: desktop ? "40px 44px" : "28px 24px",
          display: "grid",
          gridTemplateColumns: desktop ? "1fr auto" : "1fr",
          gap: 24,
          alignItems: "center",
        }}
      >
        <div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontFamily: FONT_MONO,
              fontSize: 12,
              letterSpacing: 1,
              color: BRAND,
              textTransform: "uppercase",
            }}
          >
            <Zap size={14} /> One account · open models · cents per turn
          </div>
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 800,
              fontSize: desktop ? 30 : 24,
              // Same fixed-line-height trap as the h2 above: styles.css sets
              // `h3 { line-height: 24px }` for an 18px heading.
              lineHeight: 1.15,
              letterSpacing: -0.8,
              margin: "12px 0 0",
              maxWidth: 620,
            }}
          >
            No paywall in front of a real answer.
          </h3>
          <p
            style={{
              marginTop: 10,
              fontSize: 15,
              lineHeight: 1.6,
              color: MUTED,
              maxWidth: 620,
            }}
          >
            Ugly Chat runs on ugly.bot — cheap-by-default model routing, honest
            receipts, built and maintained by one engineer. Your conversations,
            your storage, your bill.
          </p>
        </div>
        <a
          href="/"
          onClick={openChat}
          className="lp-cta"
          style={{ ...primaryCta, whiteSpace: "nowrap" }}
          data-id="start-chatting"
        >
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
      <div
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "28px 24px",
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 16 }}
        >
          ugly<span style={{ color: BRAND }}>.</span>chat
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: FAINT }}>
          powered by ugly.bot · © 2026
        </span>
        <div style={{ display: "flex", gap: 18, fontSize: 13 }}>
          <a
            href="/"
            onClick={openChat}
            className="lp-link"
            style={footLink}
            data-id="open-chat-3"
          >
            Open chat
          </a>
          <a
            href="https://ugly.bot"
            className="lp-link"
            style={footLink}
            data-id="ugly-bot"
          >
            ugly.bot
          </a>
        </div>
      </div>
    </footer>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────
function SectionLabel({
  n,
  label,
}: {
  n: string;
  label: string;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        // The kit's section label: mono, wide-tracked, brand-coloured.
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: "0.26em",
        fontWeight: 700,
        color: BRAND,
        textTransform: "uppercase",
      }}
    >
      <span>{n}</span>
      <span style={{ width: 24, height: 1, background: BORDER_STRONG }} />
      {label}
    </div>
  );
}

// Square, mono, wide-tracked — the kit's vocabulary, not a pill.
const eyebrow: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 9,
  fontFamily: FONT_MONO,
  fontSize: 11,
  letterSpacing: "0.18em",
  fontWeight: 700,
  color: MUTED,
  textTransform: "uppercase",
  border: `1px solid ${BORDER}`,
  padding: "7px 13px",
};

// Mirrors landingKit's PrimaryButton so the two sites' CTAs are the same object.
const primaryCta: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  padding: "18px 32px",
  fontFamily: FONT_MONO,
  fontSize: 15,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  border: `1px solid ${BRAND}`,
  background: BRAND,
  color: ON_BRAND,
  fontWeight: 700,
  textDecoration: "none",
};

// Mirrors landingKit's GhostButton.
const ghostCta: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  padding: "14px 24px",
  fontFamily: FONT_MONO,
  fontSize: 13,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
  border: `1px solid ${BORDER_STRONG}`,
  color: TEXT,
  fontWeight: 700,
  textDecoration: "none",
  background: "transparent",
};

// Square 1px card on an elevated surface — the kit's card, everywhere.
const featureCard: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  padding: "28px 26px",
  border: `1px solid ${BORDER}`,
  background: ELEV,
};

const footLink: React.CSSProperties = { color: MUTED, textDecoration: "none" };

// Injected once: hover/animation that inline styles can't express.
function StyleOnce(): React.ReactElement {
  return (
    <style>{`
      .lp-cta { transition: transform .14s ease, box-shadow .14s ease; }
      .lp-cta:hover { transform: translateY(-1px); box-shadow: 0 0 28px rgba(255,85,0,0.45); }
      .lp-cta-ghost { transition: border-color .14s ease, color .14s ease; }
      .lp-cta-ghost:hover { border-color: ${BRAND}; color: ${TEXT}; }
      .lp-feature { transition: border-color .14s ease, transform .14s ease; }
      .lp-feature:hover { border-color: ${BRAND}; transform: translateY(-2px); }
      .lp-link:hover { color: ${BRAND} !important; }
      .lp-pulse { animation: lp-pulse 1.8s ease-in-out infinite; }
      @keyframes lp-pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
    `}</style>
  );
}
