import React from 'react';
import type { ConvRow } from '../lib/conversations';
import { ConversationRow } from './ConversationRow';

// The grouped conversation list shared by the desktop Sidebar and the mobile
// ChatHomePage: a `// PINNED` section (rows where `pinned`) followed by a
// `// DIRECT` section (the rest), with loading / empty hints. The caller does
// the filtering (search) and supplies navigation + pin handlers.
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

  if (loading && conversations.length === 0) return <EmptyHint text="Loading…" />;
  if (filtered.length === 0) return <EmptyHint text={searching ? 'No matches' : 'No conversations yet'} />;

  const renderRow = (c: ConvRow): React.ReactElement => (
    <ConversationRow
      key={c.conversationId}
      row={c}
      selected={c.conversationId === activeId}
      onClick={() => onSelect(c.conversationId)}
      {...(onTogglePin ? { onTogglePin: () => onTogglePin(c.conversationId, !c.pinned) } : {})}
      {...(onDelete ? { onDelete: () => onDelete(c.conversationId) } : {})}
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
      {rest.length > 0 ? (
        <>
          <SectionLabel text="direct" />
          {rest.map(renderRow)}
        </>
      ) : null}
    </>
  );
}

export function SectionLabel({ text }: { text: string }): React.ReactElement {
  return (
    <div className="uc-mono-label" style={{ padding: '12px 14px 4px' }}>
      <span style={{ color: 'var(--app-primary)' }}>//</span> {text}
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
