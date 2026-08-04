/**
 * Shared primitives for ugly.bot's public marketing pages.
 *
 * Copied from ugly-bot/client/landing/ — keep in sync by hand; the two repos
 * share no package.
 *
 * Extracted from LandingPage.tsx so the landing page and the download page are
 * visibly the same artifact — same shell width, same section rhythm, same
 * buttons — rather than two hand-rolled approximations that drift apart.
 *
 * Everything here is imported by pages listed in `client/ssrPages.ts`, which are
 * inlined into `worker.js` (no code splitting, size-budgeted). Keep it
 * dependency-free: inline styles and SVG only.
 */
import React, { useSyncExternalStore } from "react";
import {
  BORDER,
  BORDER_STRONG,
  BRAND,
  BRAND_GLOW_STRONG,
  BG,
  FONT_DISPLAY,
  FONT_MONO,
  TEXT,
  TEXT_MUTED,
} from "./landingBrandTokens";

// ---------------------------------------------------------------------------
// Responsive helper (replaces the monolith's global.isDesktop)
// ---------------------------------------------------------------------------

export const DESKTOP_QUERY = "(min-width: 900px)";

function subscribeToViewport(onChange: () => void): () => void {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", onChange);
  return () => {
    mql.removeEventListener("change", onChange);
  };
}

/**
 * These pages are server-rendered, so the FIRST client render must produce
 * exactly what the server produced or React discards the SSR'd DOM. Reading
 * `window.innerWidth` in a `useState` initializer would do precisely that: the
 * server has no viewport (renders desktop), a phone hydrates mobile, mismatch.
 *
 * `useSyncExternalStore` splits the two cases properly — it uses the server
 * snapshot for the hydration render (matching the markup), then re-renders with
 * the real viewport. On a client-only `createRoot` render it uses the real
 * viewport immediately, so no flash is introduced where there wasn't one.
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeToViewport,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => true, // server + hydration snapshot
  );
}

// ---------------------------------------------------------------------------
// Style injection (hover/focus selectors that can't be expressed inline)
// ---------------------------------------------------------------------------

let kitStylesInjected = false;

/**
 * Hover and focus rules shared by every marketing page. Idempotent, and safe to
 * call from any page's mount effect. Page-specific keyframes stay with their
 * page (see LandingPage's starfield).
 */
export function injectLandingStyles(): void {
  if (kitStylesInjected || typeof document === "undefined") return;
  kitStylesInjected = true;
  const sheet = document.createElement("style");
  sheet.textContent = `
    .ugly-cta:hover {
      box-shadow: 0 0 24px ${BRAND_GLOW_STRONG};
      transform: translateY(-1px);
    }
    .ugly-cta:focus-visible,
    .ugly-link:focus-visible,
    .ugly-card:focus-visible {
      outline: 2px solid ${BRAND};
      outline-offset: 3px;
    }
    .ugly-card:hover { border-color: ${BRAND} !important; }
    .ugly-link:hover { color: ${BRAND} !important; }
    @media (prefers-reduced-motion: reduce) {
      .ugly-cta:hover { transform: none; }
    }
  `;
  document.head.appendChild(sheet);
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1240, margin: "0 auto", width: "100%" }}>
      {children}
    </div>
  );
}

export function SectionWrap({
  children,
  id,
  tint,
  isDesktop,
}: {
  children: React.ReactNode;
  id?: string;
  tint?: boolean;
  isDesktop: boolean;
}) {
  return (
    <div
      id={id}
      style={{
        padding: `${isDesktop ? 96 : 56}px calc(var(--safe-area-inset-right, 0px) + 24px) ${isDesktop ? 96 : 56}px calc(var(--safe-area-inset-left, 0px) + 24px)`,
        borderTop: `1px solid ${BORDER}`,
        background: tint
          ? `linear-gradient(180deg, ${BG} 0%, rgba(255, 85, 0, 0.03) 100%)`
          : BG,
      }}
    >
      <Shell>{children}</Shell>
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: "0.26em",
        textTransform: "uppercase",
        color: BRAND,
        fontWeight: 700,
        marginBottom: 22,
      }}
    >
      {children}
    </div>
  );
}

export function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: FONT_DISPLAY,
        fontWeight: 800,
        letterSpacing: "-0.035em",
        lineHeight: 1,
        fontSize: "clamp(36px, 5vw, 56px)",
        margin: "0 0 24px",
        color: TEXT,
      }}
    >
      {children}
    </h2>
  );
}

export function SectionSub({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: FONT_MONO,
        fontSize: 13.5,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: TEXT_MUTED,
        fontWeight: 600,
        margin: "0 0 44px",
      }}
    >
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export function PrimaryButton({
  children,
  onClick,
  href,
  external,
  as,
  large,
  dataId,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  external?: boolean;
  as?: "span";
  large?: boolean;
  dataId?: string;
}) {
  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: large ? "18px 32px" : "14px 24px",
    fontFamily: FONT_MONO,
    fontSize: large ? 15 : 13,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    fontWeight: 700,
    border: `1px solid ${BRAND}`,
    background: BRAND,
    color: "#fff",
    cursor: as === "span" ? "inherit" : "pointer",
    textDecoration: "none",
    transition: "all 160ms ease",
  };
  if (as === "span") {
    return (
      <span className="ugly-cta" style={style}>
        {children}
      </span>
    );
  }
  if (href) {
    return (
      <a
        className="ugly-cta"
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        style={style}
        data-id={dataId ?? "primary-link"}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      className="ugly-cta"
      type="button"
      onClick={onClick}
      style={style}
      data-id={dataId ?? "primary-button"}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  href,
  external,
  as,
  dataId,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  external?: boolean;
  as?: "span";
  dataId?: string;
}) {
  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    padding: "14px 24px",
    fontFamily: FONT_MONO,
    fontSize: 13,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    fontWeight: 700,
    border: `1px solid ${BORDER_STRONG}`,
    background: "transparent",
    color: TEXT,
    cursor: as === "span" ? "inherit" : "pointer",
    textDecoration: "none",
    transition: "all 160ms ease",
  };
  if (as === "span") {
    return (
      <span className="ugly-cta" style={style}>
        {children}
      </span>
    );
  }
  if (href) {
    return (
      <a
        className="ugly-cta"
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        style={style}
        data-id={dataId ?? "ghost-link"}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      className="ugly-cta"
      type="button"
      onClick={onClick}
      style={style}
      data-id={dataId ?? "ghost-button"}
    >
      {children}
    </button>
  );
}
