import React from 'react';
import type { ConvRow } from '../lib/conversations';
import { ConversationRow } from './ConversationRow';
import { isDirectRoom } from '../../shared/conversationId';

// The grouped conversation list shared by the desktop Sidebar and the mobile
// ChatHomePage: `// PINNED` (rows where `pinned`), then `// DIRECT` (1:1s with
// a person or a bot), then `// GROUPS`, with loading / empty hints. The caller
// does the filtering (search) and supplies navigation + pin handlers.
export function ConversationListBody({
  conversations,
  filtered,
  loading,
  searching,
  activeId,
  onSelect,
  onTogglePin,
  onDelete,
}: {
  /** Full (unfiltered) list — used only to distinguish "loading" from "empty". */
  conversations: ConvRow[];
  /** The rows to render (already search-filtered by the caller). */
  filtered: ConvRow[];
  loading: boolean;
  /** Whether a search query is active (controls the empty-state copy). */
  searching: boolean;
  activeId: string | null;
  onSelect: (conversationId: string) => void;
  onTogglePin?: (conversationId: string, pinned: boolean) => void;
  onDelete?: (conversationId: string) => void;
}): React.ReactElement {
  const pinned = filtered.filter((c) => c.pinned);
  const rest = filtered.filter((c) => !c.pinned);
  // Everything unpinned used to land under one `// DIRECT` heading, so a group
  // was filed as a direct message. Bot chats count as direct — they're a 1:1
  // with a bot, stored as a group.
  const direct = rest.filter((c) => isDirectRoom(c.conversationId, c.type));
  const groups = rest.filter((c) => !isDirectRoom(c.conversationId, c.type));

  if (loading && conversations.length === 0) return <EmptyHint text="Loading…" />;
  if (filtered.length === 0) return <EmptyHint text={searching ? 'No matches' : 'No conversations yet'} />;

  const renderRow = (c: ConvRow): React.ReactElement => (
    <ConversationRow
      key={c.conversationId}
      row={c}
      selected={c.conversationId === activeId}
      onClick={() => { onSelect(c.conversationId); }}
      {...(onTogglePin ? { onTogglePin: () => { onTogglePin(c.conversationId, !c.pinned); } } : {})}
      {...(onDelete ? { onDelete: () => { onDelete(c.conversationId); } } : {})} data-id="conversation-row"
    />
  );

  return (
    <>
      {pinned.length > 0 ? (
        <>
          <SectionLabel text="pinned" />
          {pinned.map(renderRow)}
        </>
      ) : null}
      {direct.length > 0 ? (
        <>
          <SectionLabel text="direct" />
          {direct.map(renderRow)}
        </>
      ) : null}
      {groups.length > 0 ? (
        <>
          <SectionLabel text="groups" />
          {groups.map(renderRow)}
        </>
      ) : null}
    </>
  );
}

export function SectionLabel({ text }: { text: string }): React.ReactElement {
  return (
    <div className="uc-mono-label" style={{ padding: '12px 14px 4px' }}>
      <span style={{ color: 'var(--app-primary)' }}>{'//'}</span> {text}
    </div>
  );
}

function EmptyHint({ text }: { text: string }): React.ReactElement {
  return (
    <div style={{ padding: '24px 14px', textAlign: 'center', fontSize: 13, color: 'var(--app-foreground)', opacity: 0.45 }}>
      {text}
    </div>
  );
}
