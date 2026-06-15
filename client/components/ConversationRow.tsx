import React from 'react';
import { Pin } from 'lucide-react';
import { Avatar, type ConvRow } from '../lib/conversations';

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
            top: '50%',
            transform: 'translateY(-50%)',
            width: 4,
            height: 28,
            borderRadius: 999,
            background: 'var(--app-primary)',
          }}
        />
      ) : null}

      <Avatar image={row.image} seed={row.conversationId} label={row.title} size={42} />

      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
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
            minWidth: 18,
            height: 18,
            padding: '0 5px',
            borderRadius: 999,
            background: 'var(--app-primary)',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
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
