import React from 'react';
import { Pin } from 'lucide-react';
import { Avatar, type ConvRow } from '../lib/conversations';

// Compact relative timestamp for the row's lastActivity (ms epoch):
// "now", "2m", "1h", "9h", "yest", "3d", then a short date for older.
function relativeTime(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return '';
  const diff = Date.now() - ms;
  if (diff < 0) return 'now';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yest';
  if (day < 7) return `${day}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// A single conversation row, styled after ugly.bot's sidebar rows:
// 42px circular avatar, bold name, muted 1-line preview, orange selected
// state with a left edge bar, unread badge, pin marker.
export function ConversationRow(props: {
  row: ConvRow;
  selected: boolean;
  onClick: () => void;
  onTogglePin?: () => void;
}): React.ReactElement {
  const { row, selected, onClick, onTogglePin } = props;
  return (
    <div className="uc-convrow" style={{ position: 'relative' }}>
    <button
      type="button"
      onClick={onClick}
      className="uc-row"
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '7px 14px',
        border: 'none',
        borderRadius: 0,
        cursor: 'pointer',
        textAlign: 'left',
        background: selected ? 'rgba(var(--app-primary-rgb), 0.10)' : 'transparent',
        font: 'inherit',
      }}
    >
      {selected ? (
        <span
          style={{
            position: 'absolute',
            left: 0,
            top: 8,
            bottom: 8,
            width: 2,
            borderRadius: 0,
            background: 'var(--app-primary)',
          }}
        />
      ) : null}

      <Avatar image={row.image} seed={row.conversationId} label={row.title} size={42} />

      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              lineHeight: '20px',
              color: selected ? 'var(--app-primary)' : 'var(--app-foreground)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {row.title || 'Conversation'}
          </span>
          {relativeTime(row.lastActivity) ? (
            <span
              style={{
                flex: 'none',
                fontFamily: 'var(--app-font-mono)',
                fontSize: 10,
                color: 'var(--app-foreground-muted)',
              }}
            >
              {relativeTime(row.lastActivity)}
            </span>
          ) : null}
        </span>
        {row.preview ? (
          <span
            style={{
              fontSize: 12,
              lineHeight: '16px',
              color: 'var(--app-foreground)',
              opacity: 0.5,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {row.preview}
          </span>
        ) : null}
      </span>

      {!onTogglePin && row.pinned ? <Pin size={12} style={{ opacity: 0.45, flexShrink: 0 }} aria-label="Pinned" /> : null}
      {row.unread > 0 ? (
        <span
          style={{
            minWidth: 20,
            height: 20,
            padding: '0 5px',
            borderRadius: 0,
            background: 'var(--app-primary)',
            color: 'var(--app-on-primary)',
            fontSize: 10,
            fontWeight: 700,
            fontFamily: 'var(--app-font-mono)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {row.unread > 99 ? '99+' : row.unread}
        </span>
      ) : null}
    </button>
      {onTogglePin ? (
        <button
          type="button"
          className={row.pinned ? 'uc-pinbtn uc-pinbtn--on' : 'uc-pinbtn'}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          title={row.pinned ? 'Unpin' : 'Pin'}
          aria-label={row.pinned ? 'Unpin' : 'Pin'}
        >
          <Pin size={14} fill={row.pinned ? 'currentColor' : 'none'} />
        </button>
      ) : null}
    </div>
  );
}
