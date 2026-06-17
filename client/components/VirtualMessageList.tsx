import React, {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ChatMessage } from 'ugly-app/conversation/shared';

// Distance-from-bottom (px) that still counts as "pinned to the bottom".
const BOTTOM_THRESHOLD = 60;
// Show the jump-to-bottom button once scrolled this far up.
const SCROLL_BUTTON_THRESHOLD = 300;
// Scrolling within this many px of the top pulls in the next page of history.
const LOAD_MORE_THRESHOLD = 250;

// A markdown body can throw mid-render; isolate each row so one bad message
// can't blank the whole thread (mirrors the monolith's VirtualItemErrorBoundary).
class RowErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state: { failed: boolean } = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <div style={{ height: 48 }} /> : this.props.children;
  }
}

export interface VirtualMessageListProps {
  messages: ChatMessage[];
  currentUserId: string;
  renderItem: (msg: ChatMessage) => ReactNode;
  /** More (older) history exists above the loaded window. */
  hasMore: boolean;
  /** Pull in the next page of older messages (scroll-up triggered). */
  onLoadMore: () => void;
  /** The composer, pinned below the scroll area. */
  bottom?: ReactNode;
}

/**
 * Virtualized, bottom-anchored chat thread. Only the visible message rows are
 * mounted (via @tanstack/react-virtual), so opening a long conversation no
 * longer parses hundreds of markdown bodies at once. Older history streams in
 * as the user scrolls up; the viewport is held steady across the prepend.
 */
export function VirtualMessageList({
  messages,
  currentUserId,
  renderItem,
  hasMore,
  onLoadMore,
  bottom,
}: VirtualMessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const virtualContainerRef = useRef<HTMLDivElement>(null);

  const atBottomRef = useRef(true);
  const programmaticRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const [showButton, setShowButton] = useState(false);
  const [scrollMargin, setScrollMargin] = useState(0);

  const getItemKey = useCallback(
    (index: number) => messages[index]?.id ?? index,
    [messages],
  );
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 8,
    getItemKey,
    scrollMargin,
  });

  // Measure the offset from the scroll-container top to the virtual list. With
  // flex-end alignment a short thread is pushed to the bottom, so this offset is
  // dynamic — feed it back into both the virtualizer and each row's transform.
  useLayoutEffect(() => {
    if (!virtualContainerRef.current) return;
    const margin = virtualContainerRef.current.offsetTop;
    if (margin !== scrollMargin) setScrollMargin(margin);
  });

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    programmaticRef.current = true;
    el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setShowButton(false);
    requestAnimationFrame(() => {
      programmaticRef.current = false;
    });
  }, []);

  // Initial pin to the bottom — retried across a few frames so late layout
  // (avatars, markdown, fonts) doesn't leave us short of the true bottom.
  const didInitialRef = useRef(false);
  useEffect(() => {
    if (didInitialRef.current || messages.length === 0) return;
    didInitialRef.current = true;
    let n = 0;
    const tick = () => {
      scrollToBottom();
      if (n++ < 4) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [messages.length, scrollToBottom]);

  // New message arrived (append, not a load-more prepend): keep the thread
  // pinned if the user is already at the bottom, and always follow your own send.
  const prevLastIdRef = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const last = messages[messages.length - 1];
    const lastChanged = last?.id !== prevLastIdRef.current;
    if (lastChanged && !isLoadingMoreRef.current && prevLastIdRef.current !== undefined) {
      if (atBottomRef.current || last?.userId === currentUserId) {
        scrollToBottom();
      }
    }
    prevLastIdRef.current = last?.id;
  }, [messages, currentUserId, scrollToBottom]);

  // Older messages were prepended by a load-more: shift scrollTop by the height
  // delta so the user's viewport stays anchored on the same content (no jump).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (isLoadingMoreRef.current && el && prevScrollHeightRef.current > 0) {
      const delta = el.scrollHeight - prevScrollHeightRef.current;
      if (delta > 0) {
        programmaticRef.current = true;
        el.scrollTop += delta;
        requestAnimationFrame(() => {
          programmaticRef.current = false;
        });
      }
      isLoadingMoreRef.current = false;
    }
    if (el) prevScrollHeightRef.current = el.scrollHeight;
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || programmaticRef.current) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = dist <= BOTTOM_THRESHOLD;
    setShowButton(dist > SCROLL_BUTTON_THRESHOLD);
    if (el.scrollTop < LOAD_MORE_THRESHOLD && hasMore && !isLoadingMoreRef.current) {
      isLoadingMoreRef.current = true;
      prevScrollHeightRef.current = el.scrollHeight;
      onLoadMore();
    }
  }, [hasMore, onLoadMore]);

  // Keep the bottom anchored when the container shrinks (keyboard opens and the
  // composer's safe-area padding grows) or content grows (images/markdown lay
  // out). Observing only content missed the container-shrink case.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current && !programmaticRef.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    if (innerRef.current) ro.observe(innerRef.current);
    return () => {
      ro.disconnect();
    };
  }, []);

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        data-testid="conversation-scroll-container"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
        <div
          ref={innerRef}
          data-testid="message-list-inner"
          style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', minHeight: '100%' }}
        >
          {hasMore ? (
            <div style={{ textAlign: 'center', padding: '12px 0', fontSize: 12, opacity: 0.5 }}>Loading earlier messages…</div>
          ) : null}
          <div ref={virtualContainerRef} style={{ height: totalSize, width: '100%', position: 'relative' }}>
            {items.map((row) => {
              const item = messages[row.index];
              if (!item) return null;
              return (
                <div
                  key={item.id}
                  data-index={row.index}
                  data-message-id={item.id}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${row.start - scrollMargin}px)`,
                  }}
                >
                  <RowErrorBoundary>{renderItem(item)}</RowErrorBoundary>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {showButton ? (
        <button
          type="button"
          data-id="scroll-to-latest"
          onClick={scrollToBottom}
          aria-label="Scroll to latest"
          title="Scroll to latest"
          style={{
            position: 'absolute',
            right: 16,
            bottom: 12,
            width: 38,
            height: 38,
            borderRadius: '50%',
            border: '1px solid var(--app-border)',
            background: 'var(--app-main)',
            color: 'var(--app-foreground)',
            boxShadow: 'var(--app-shadow-button-default)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            zIndex: 3,
          }}
        >
          <ChevronDown size={20} />
        </button>
      ) : null}
      </div>
      {bottom}
    </div>
  );
}
