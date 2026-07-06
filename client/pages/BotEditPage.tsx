import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, X, Plus, Trash2, ArrowLeft, Loader2 } from 'lucide-react';
import { useApp, uploadBlob, promoteBlob, downscaleImage } from 'ugly-app/client';
import { defaultAvatar, type Avatar } from 'ugly-app/shared';
import { useRouter } from '../router';
import { BOT_MODELS, startBotChat, type BotDoc } from '../lib/bots';

interface ButtonRow {
  label: string;
  prompt: string;
}

// Create / edit a custom bot. Route 'bot/:botId' — botId='new' creates,
// otherwise edits the existing bot.
export default function BotEditPage({ botId }: { botId?: string }): React.ReactElement {
  const { socket, userId } = useApp();
  const router = useRouter();
  const editId = botId && botId !== 'new' ? botId : undefined;
  const editing = !!editId;

  const [name, setName] = useState('');
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState(BOT_MODELS[0]!.id);
  const [avatar, setAvatar] = useState<Avatar>(defaultAvatar);
  const [firstMessage, setFirstMessage] = useState('');
  const [buttons, setButtons] = useState<ButtonRow[]>([]);
  const [loaded, setLoaded] = useState(!editing);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editId) return;
    void socket
      .request('botGet', { botId: editId })
      .then((doc) => {
        const b = doc as BotDoc | null;
        if (!b) return;
        setName(b.name);
        setInstruction(b.instruction ?? '');
        setModel(b.model ?? BOT_MODELS[0]!.id);
        setAvatar(b.avatar ?? defaultAvatar);
        setFirstMessage(b.firstMessage ?? '');
        setButtons(b.buttons ?? []);
      })
      .catch((err: unknown) => { console.error('[BotEdit] load failed', err); })
      .finally(() => { setLoaded(true); });
  }, [socket, editId]);

  const save = useCallback(
    async (thenChat: boolean) => {
      if (!name.trim() || saving) return;
      setSaving(true);
      const payload = {
        name: name.trim(),
        instruction,
        model,
        avatar,
        firstMessage: firstMessage.trim() || null,
        buttons: buttons.filter((b) => b.label.trim() && b.prompt.trim()),
      };
      try {
        let id = editId;
        if (editId) {
          await socket.request('botUpdate', { botId: editId, ...payload });
        } else {
          const res = (await socket.request('botCreate', payload)) as { botId: string };
          id = res.botId;
        }
        if (thenChat && id) {
          await startBotChat(socket, userId, { _id: id, ownerId: userId, ...payload }, (cid) =>
            { router.push(':conversationId', { conversationId: cid }); },
          );
        } else {
          router.push('', {});
        }
      } catch (err) {
        console.error('[BotEdit] save failed', err);
        setSaving(false);
      }
    },
    [name, instruction, model, avatar, firstMessage, buttons, saving, editId, socket, userId, router],
  );

  if (!loaded) {
    return (
      <div style={{ ...page, alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="uc-spin" size={28} color="var(--app-primary)" />
      </div>
    );
  }

  return (
    <div style={page}>
      <div style={{ maxWidth: 640, margin: '0 auto', width: '100%', boxSizing: 'border-box', padding: '20px 18px 60px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <button type="button" onClick={() => { router.push('', {}); }} aria-label="Back" style={iconBtn}>
            <ArrowLeft size={20} />
          </button>
          <h1 style={{ fontFamily: 'var(--app-font-heading)', fontWeight: 800, fontSize: 24, margin: 0, color: 'var(--app-foreground)' }}>
            {editing ? 'Edit bot' : 'New bot'}
          </h1>
        </div>

        {/* Avatar */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 18 }}>
          <ImageField
            label="Avatar"
            url={avatar.image.uri === defaultAvatar.image.uri ? null : avatar.image.uri}
            onChange={(url) =>
              { setAvatar((a) => (url ? { ...a, uri: null, image: { uri: url } } : defaultAvatar)); }
            }
            round
            size={96}
            socket={socket}
          />
        </div>

        <Field label="Name">
          <input value={name} onChange={(e) => { setName(e.target.value); }} placeholder="My Bot" maxLength={60} style={input} />
        </Field>

        <Field label="Model">
          <select value={model} onChange={(e) => { setModel(e.target.value); }} style={{ ...input, cursor: 'pointer' }}>
            {BOT_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </Field>

        <Field label="Instruction (system prompt)" hint="How the bot should behave, its persona, rules.">
          <textarea
            value={instruction}
            onChange={(e) => { setInstruction(e.target.value); }}
            placeholder="You are a friendly tutor who explains things simply…"
            rows={5}
            maxLength={8000}
            style={{ ...input, resize: 'vertical', lineHeight: 1.5 }}
          />
        </Field>

        <Field label="First message" hint="The bot's opening greeting when a chat starts.">
          <textarea
            value={firstMessage}
            onChange={(e) => { setFirstMessage(e.target.value); }}
            placeholder="Hi! What would you like to learn today?"
            rows={2}
            maxLength={2000}
            style={{ ...input, resize: 'vertical', lineHeight: 1.5 }}
          />
        </Field>

        <Field label="Starter buttons" hint="Tappable buttons that send a preset prompt.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {buttons.map((b, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  value={b.label}
                  onChange={(e) => { setButtons((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))); }}
                  placeholder="Label"
                  maxLength={40}
                  style={{ ...input, flex: '1 1 110px', minWidth: 0 }}
                />
                <input
                  value={b.prompt}
                  onChange={(e) => { setButtons((p) => p.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x))); }}
                  placeholder="Prompt it sends…"
                  maxLength={2000}
                  style={{ ...input, flex: '2 1 140px', minWidth: 0 }}
                />
                <button type="button" onClick={() => { setButtons((p) => p.filter((_, j) => j !== i)); }} aria-label="Remove" style={iconBtn}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => { setButtons((p) => [...p, { label: '', prompt: '' }]); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, alignSelf: 'flex-start', padding: '7px 12px', borderRadius: 10, border: '1px solid var(--app-border)', background: 'var(--app-tertiary)', color: 'var(--app-foreground)', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
            >
              <Plus size={16} /> Add button
            </button>
          </div>
        </Field>

        <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
          <button type="button" disabled={!name.trim() || saving} onClick={() => void save(true)} style={{ ...primaryBtn, opacity: !name.trim() || saving ? 0.5 : 1 }}>
            {saving ? <Loader2 className="uc-spin" size={16} /> : null}
            {editing ? 'Save & chat' : 'Create & chat'}
          </button>
          <button type="button" disabled={!name.trim() || saving} onClick={() => void save(false)} style={{ ...ghostBtn, opacity: !name.trim() || saving ? 0.5 : 1 }}>
            {editing ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Image upload field ───────────────────────────────────────────────────────
function ImageField(props: {
  label: string;
  url: string | null;
  onChange: (url: string | null) => void;
  round?: boolean;
  wide?: boolean;
  size: number;
  socket: ReturnType<typeof useApp>['socket'];
}): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const w = props.wide ? props.size * 1.7 : props.size;

  const pick = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBusy(true);
      try {
        const processed = file.type.startsWith('image/') ? await downscaleImage(file, 1200) : file;
        const { key } = await uploadBlob(processed, { name: file.name });
        const url = await promoteBlob(props.socket, key);
        props.onChange(url);
      } catch (err) {
        console.error('[BotEdit] image upload failed', err);
      } finally {
        setBusy(false);
      }
    },
    [props],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={fieldLabel}>{props.label}</span>
      <div
        onClick={() => inputRef.current?.click()}
        style={{
          width: w,
          height: props.size,
          borderRadius: props.round ? '50%' : 12,
          border: '1.5px dashed var(--app-border)',
          background: props.url ? `center / cover no-repeat url(${JSON.stringify(props.url)})` : 'var(--app-tertiary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          position: 'relative',
          flexShrink: 0,
        }}
      >
        {busy ? (
          <Loader2 className="uc-spin" size={22} color="var(--app-primary)" />
        ) : !props.url ? (
          <ImagePlus size={22} color="var(--app-foreground)" style={{ opacity: 0.5 }} />
        ) : null}
        {props.url && !busy ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); props.onChange(null); }}
            aria-label="Remove"
            style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'var(--app-foreground)', color: 'var(--app-main)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <X size={13} />
          </button>
        ) : null}
      </div>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

// ── Layout bits ──────────────────────────────────────────────────────────────
function Field(props: { label: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ marginBottom: 16 }}>
      <span style={fieldLabel}>{props.label}</span>
      {props.hint ? <span style={{ display: 'block', fontSize: 12, color: 'var(--app-foreground)', opacity: 0.5, margin: '2px 0 7px' }}>{props.hint}</span> : <div style={{ height: 7 }} />}
      {props.children}
    </div>
  );
}

const page: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', background: 'var(--app-main)' };
const fieldLabel: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--app-foreground)' };
const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10,
  border: '1.5px solid var(--app-border)', background: 'var(--app-input, var(--app-main))',
  color: 'var(--app-foreground)', fontSize: 15, outline: 'none', fontFamily: 'var(--app-font-body)',
};
const iconBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36,
  borderRadius: 10, border: '1px solid var(--app-border)', background: 'transparent',
  color: 'var(--app-foreground)', cursor: 'pointer', flexShrink: 0,
};
const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px', borderRadius: 12,
  border: 'none', background: 'var(--app-primary)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', padding: '12px 22px', borderRadius: 12,
  border: '1px solid var(--app-border)', background: 'transparent', color: 'var(--app-foreground)', fontSize: 15, fontWeight: 600, cursor: 'pointer',
};
