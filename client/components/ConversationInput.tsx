import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Mic, Square } from 'lucide-react';
import { useApp, uploadBlob, promoteBlob, useSTT } from 'ugly-app/client';
import type { UglyBotSocket } from 'ugly-app/client';
import { MarkdownEditor } from 'ugly-app/markdown/client';
import type { MarkdownEditorFunctions } from 'ugly-app/markdown/client';

// Faithful port of ugly.bot's ConversationInput composer onto the ugly-app
// MarkdownEditor (which IS ugly.bot's editor). The framework's stripped-down
// ChatMarkdownInput never set `showToolbar`, which is what gates the slash
// menu + floating formatting toolbar — so the chat input lost most of its
// markdown features. This wires the FULL editor: slash menu, formatting,
// markdown input rules (## → heading, - → list, ``` → code, etc.), @mentions,
// and image paste/drop, with Enter-to-send / Shift+Enter newline.
export interface ConversationInputProps {
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Allow sending with empty text (e.g. an attachment is staged). */
  allowEmpty?: boolean;
  onSend: (markdown: string) => void;
  /** Fires as the user edits (each content change) — for typing indicators. */
  onType?: () => void;
  /** Resolve @mention candidates (conversation participants). */
  mentionSearch?: (query: string) => Promise<{ id: string; name: string }[]>;
  leftActions?: ReactNode;
  rightActions?: ReactNode;
}

function imageAspectRatio(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1.4); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(1.4); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

export function ConversationInput({
  placeholder = 'Message…',
  disabled = false,
  autoFocus = false,
  allowEmpty = false,
  onSend,
  onType,
  mentionSearch,
  leftActions,
  rightActions,
}: ConversationInputProps): React.ReactElement {
  const { socket, uglyBotSocket } = useApp();
  const editorRef = useRef<MarkdownEditorFunctions>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');
  const valueRef = useRef('');
  const [width, setWidth] = useState(520);

  // Set composer content programmatically (used by dictation) — both the
  // controlled `value` state and the live editor document.
  const applyText = useCallback((text: string) => {
    setValue(text);
    valueRef.current = text;
    editorRef.current?.setValue(text);
  }, []);

  // Track the editor width (image embeds + the floating toolbar need it).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);

  const handleSend = useCallback(() => {
    const text = value.trim();
    if (!text && !allowEmpty) return;
    onSend(text);
    setValue('');
    valueRef.current = '';
    editorRef.current?.setValue('');
  }, [value, allowEmpty, onSend]);

  // Enter sends; Shift+Enter = newline. Capture-phase so we beat ProseMirror —
  // but defer to the editor when a slash/mention menu is open (Enter picks the
  // highlighted item there).
  const handleKeyDownCapture = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key !== 'Enter' || e.shiftKey) return;
      if (editorRef.current?.isMenuActive()) return;
      e.preventDefault();
      e.stopPropagation();
      handleSend();
    },
    [handleSend],
  );

  // Paste/drop an image → upload to R2 (promote so the embedded URL is durable)
  // and embed it inline at the caret.
  const onImageUpload = useCallback(
    async (file: File): Promise<{ src: string; widthPercent: number; aspectRatio: number } | null> => {
      try {
        const { key } = await uploadBlob(file, { name: file.name });
        const src = await promoteBlob(socket, key);
        const aspectRatio = await imageAspectRatio(file);
        return { src, widthPercent: 70, aspectRatio };
      } catch (err) {
        console.error('[ConversationInput] image upload failed', err);
        return null;
      }
    },
    [socket],
  );

  return (
    <div style={containerStyle}>
      {leftActions}
      <div ref={wrapRef} style={{ flex: 1, minWidth: 0 }} onKeyDownCapture={handleKeyDownCapture}>
        <MarkdownEditor
          editorRef={editorRef}
          value={value}
          onValueChanged={(v) => {
            setValue(v);
            valueRef.current = v;
            if (v.trim()) onType?.();
          }}
          disabled={disabled}
          autoFocus={autoFocus}
          compact
          showToolbar
          limitedToolbar
          menuAbove
          editorMode="prose"
          showToc={false}
          showComments={false}
          width={width}
          fileId={null}
          placeholder={placeholder}
          {...(mentionSearch ? { onMentionSearch: mentionSearch } : {})}
          onImageUpload={onImageUpload}
        />
      </div>
      {rightActions}
      {uglyBotSocket ? (
        <DictationButton
          socket={uglyBotSocket}
          disabled={disabled}
          getBase={() => valueRef.current}
          onText={applyText}
        />
      ) : null}
      <button type="button" style={sendButtonStyle} onClick={handleSend} disabled={disabled} aria-label="Send">
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </svg>
      </button>
    </div>
  );
}

// Mic → dictate into the composer via ugly.bot's WebSocket STT (Whisper).
// Rendered only when an ugly.bot socket exists, so `useSTT` gets a real socket.
// The backend is batch (transcript arrives when you stop), so this reads as
// push-to-talk: tap to record, tap again to insert. The transcript is appended
// to whatever was already typed (captured when recording starts).
function DictationButton({
  socket,
  disabled,
  getBase,
  onText,
}: {
  socket: UglyBotSocket;
  disabled: boolean;
  getBase: () => string;
  onText: (text: string) => void;
}): React.ReactElement {
  const stt = useSTT(socket);
  const baseRef = useRef('');

  useEffect(() => {
    const t = stt.transcript.trim();
    if (!t) return;
    const base = baseRef.current.trim();
    onText(base ? `${base} ${t}` : t);
  }, [stt.transcript, onText]);

  // Push-to-talk: hold to record, release (or pointer leaves/cancels) to stop
  // and insert. Pointer events cover both mouse and touch. preventDefault on
  // pointerdown keeps the editor focus/caret from being stolen.
  const startHold = (e: React.PointerEvent): void => {
    e.preventDefault();
    if (stt.listening) return; // guard against double-start
    baseRef.current = getBase();
    void stt.start();
  };
  const endHold = (): void => {
    if (stt.listening) stt.stop();
  };

  return (
    <button
      type="button"
      onPointerDown={startHold}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onPointerCancel={endHold}
      disabled={disabled}
      title={stt.listening ? 'Recording — release to insert' : 'Hold to talk'}
      aria-label={stt.listening ? 'Recording — release to insert' : 'Hold to talk'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        flexShrink: 0,
        borderRadius: '50%',
        border: 'none',
        background: stt.listening ? 'var(--app-error)' : 'transparent',
        color: stt.listening ? '#fff' : 'var(--app-foreground)',
        cursor: 'pointer',
      }}
    >
      {stt.listening ? <Square size={15} /> : <Mic size={18} />}
    </button>
  );
}

const containerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 6,
  padding: '4px 6px 4px 10px',
  borderRadius: 0,
  border: 'none',
  background: 'var(--app-main)',
};

const sendButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  flexShrink: 0,
  borderRadius: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--app-primary)',
  cursor: 'pointer',
};
