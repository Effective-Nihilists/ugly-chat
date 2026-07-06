/**
 * ChatMedia — image attachment rendering + fullscreen pan/zoom viewer.
 *
 * Layout rules (see the explanation in the PR/commit):
 *  - Images go EDGE-TO-EDGE (full bubble width, no padding) when the message is
 *    image-dominant (no text, or just a short caption).
 *  - When the message carries long text, images render at a modest CENTERED size
 *    so the text stays the primary content.
 *  - Aspect ratio: landscape/square fill the bubble width; portraits that would
 *    exceed the height cap are constrained by height and centered (so they never
 *    dominate the viewport and never letterbox).
 *  - Width adapts to the pane: the media bubble is `min(100%, MEDIA_MAX)`, so it
 *    fills narrow mobile bubbles and caps on wide desktops.
 *
 * Tapping any image opens `ImageZoomViewer` — a fullscreen overlay with unified
 * pointer-event pan/zoom: mouse wheel + drag + double-click, and touch pinch
 * (two fingers) + drag + double-tap.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Maximize2 } from 'lucide-react';

export const MEDIA_MAX = 480; // desktop cap for an edge-to-edge media bubble
const TALL_MAX_H = 480; // an image never renders taller than this
const CENTERED_MAX = 320; // modest width when the message is text-dominant

/** Markdown image: ![alt](url "title") — global so we can extract every match. */
const IMG_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

export interface ExtractedImage { alt: string; url: string }

/** Pull every markdown image out of `md`, returning the images + the leftover text. */
export function extractImages(md: string): { images: ExtractedImage[]; text: string } {
  const images: ExtractedImage[] = [];
  const text = md
    .replace(IMG_RE, (_m, alt: string, url: string) => {
      images.push({ alt, url });
      return '';
    })
    // collapse the blank lines left where images used to be
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { images, text };
}

/** One inline chat image with the edge-to-edge / centered + aspect-ratio rules. */
export function ChatImage({
  src,
  alt,
  edgeToEdge,
  onOpen,
  isSelected,
}: {
  src: string;
  alt: string;
  edgeToEdge: boolean;
  onOpen: (src: string, alt: string) => void;
  isSelected: boolean;
}): React.ReactElement {
  const [ar, setAr] = useState<number | null>(null); // naturalWidth / naturalHeight

  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFiredRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const cancelPress = useCallback(() => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    longFiredRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY };
    cancelPress();
    pressTimer.current = setTimeout(() => {
      longFiredRef.current = true;
      onOpen(src, alt);
    }, 450);
  }, [cancelPress, onOpen, src, alt]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = startRef.current;
    if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) cancelPress();
  }, [cancelPress]);

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    // If a long-press already opened the viewer, swallow the trailing click so
    // it doesn't also select the message.
    if (longFiredRef.current) {
      e.preventDefault();
      e.stopPropagation();
      longFiredRef.current = false;
    }
  }, []);

  // Wrapper width policy:
  //  - text-dominant  → modest, centered column.
  //  - edge-to-edge   → fill the bubble; but if the natural ratio would make the
  //    image taller than TALL_MAX_H at full width (portraits), constrain the
  //    wrapper to height*ar and center it so height === TALL_MAX_H, no letterbox.
  let wrap: React.CSSProperties;
  if (!edgeToEdge) {
    wrap = { maxWidth: CENTERED_MAX, width: '100%', margin: '6px auto 0' };
  } else if (ar !== null && ar < MEDIA_MAX / TALL_MAX_H) {
    wrap = { maxWidth: Math.round(TALL_MAX_H * ar), width: '100%', margin: '0 auto' };
  } else {
    wrap = { width: '100%' };
  }

  return (
    <div style={{ ...wrap, position: 'relative' }}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        draggable={false}
        onLoad={(e) => {
          const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
          if (w > 0 && h > 0) setAr(w / h);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onClickCapture={onClickCapture}
        style={{
          display: 'block',
          width: '100%',
          height: 'auto',
          maxHeight: TALL_MAX_H,
          objectFit: 'contain',
          cursor: 'pointer',
          borderRadius: edgeToEdge ? 0 : 8,
          touchAction: 'manipulation',
        }}
      />
      {isSelected ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(src, alt); }}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontFamily: 'var(--app-font-mono)',
            fontSize: 11,
            fontWeight: 600,
            padding: '5px 9px',
            border: '1px solid var(--app-border)',
            borderRadius: 6,
            background: 'var(--app-main)',
            color: 'var(--app-foreground)',
            cursor: 'pointer',
            boxShadow: 'var(--app-shadow-button-default)',
          }}
        >
          <Maximize2 size={13} /> Open
        </button>
      ) : null}
    </div>
  );
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Fullscreen image viewer with mouse + two-finger-touch pan/zoom. */
export function ImageZoomViewer({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}): React.ReactElement {
  const wrapRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Transform maps the image's local (0,0) origin to screen space (origin 0 0).
  const [tf, setTf] = useState({ s: 1, x: 0, y: 0 });
  const tfRef = useRef(tf);
  tfRef.current = tf;
  const baseRef = useRef({ x: 0, y: 0 }); // centered position at scale 1
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; mid: { x: number; y: number } } | null>(null);

  const local = useCallback((cx: number, cy: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    return { x: cx - (r?.left ?? 0), y: cy - (r?.top ?? 0) };
  }, []);

  // Center the image once it has rendered (and on viewport resize at scale 1).
  const center = useCallback(() => {
    const wrap = wrapRef.current;
    const img = imgRef.current;
    if (!wrap || !img) return;
    const x = (wrap.clientWidth - img.clientWidth) / 2;
    const y = (wrap.clientHeight - img.clientHeight) / 2;
    baseRef.current = { x, y };
    setTf({ s: 1, x, y });
  }, []);

  useEffect(() => {
    const onResize = (): void => { if (tfRef.current.s === 1) center(); };
    window.addEventListener('resize', onResize);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
    };
  }, [center, onClose]);

  // Zoom by `factor` keeping the focal screen point (fx,fy) fixed.
  const zoomAt = useCallback((factor: number, fx: number, fy: number) => {
    setTf((t) => {
      const s = clamp(t.s * factor, MIN_SCALE, MAX_SCALE);
      const k = s / t.s;
      return { s, x: fx - (fx - t.x) * k, y: fy - (fy - t.y) * k };
    });
  }, []);

  // Wheel zoom via a non-passive native listener so preventDefault works (React's
  // synthetic onWheel is passive, which lets the page scroll behind the overlay).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const handler = (e: WheelEvent): void => {
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => { el.removeEventListener('wheel', handler); };
  }, [local, zoomAt]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = {
        dist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        mid: local((a!.x + b!.x) / 2, (a!.y + b!.y) / 2),
      };
    }
  }, [local]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const mid = local((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      const factor = dist / (pinch.current.dist || dist);
      const dx = mid.x - pinch.current.mid.x;
      const dy = mid.y - pinch.current.mid.y;
      setTf((t) => {
        const s = clamp(t.s * factor, MIN_SCALE, MAX_SCALE);
        const k = s / t.s;
        return { s, x: mid.x - (mid.x - t.x) * k + dx, y: mid.y - (mid.y - t.y) * k + dy };
      });
      pinch.current = { dist, mid };
    } else if (pointers.current.size === 1) {
      setTf((t) => ({ ...t, x: t.x + (e.clientX - prev.x), y: t.y + (e.clientY - prev.y) }));
    }
  }, [local]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    // Snap back to a clean centered fit when fully zoomed out.
    if (pointers.current.size === 0 && tfRef.current.s <= 1.001) center();
  }, [center]);

  const onDouble = useCallback((e: React.MouseEvent) => {
    if (tfRef.current.s > 1) center();
    else {
      const p = local(e.clientX, e.clientY);
      zoomAt(2.5, p.x, p.y);
    }
  }, [center, local, zoomAt]);

  return (
    <div
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDouble}
      onClick={(e) => { if (e.target === wrapRef.current && tfRef.current.s <= 1.001) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.93)',
        overflow: 'hidden',
        touchAction: 'none',
        userSelect: 'none',
        cursor: tf.s > 1 ? 'grab' : 'default',
      }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        draggable={false}
        onLoad={center}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          maxWidth: '100vw',
          maxHeight: '100vh',
          transformOrigin: '0 0',
          transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.s})`,
          willChange: 'transform',
        }}
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'fixed',
          top: 14,
          right: 14,
          width: 40,
          height: 40,
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(255,255,255,0.14)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 61,
        }}
      >
        <X size={22} />
      </button>
    </div>
  );
}
